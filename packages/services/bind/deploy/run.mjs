#!/usr/bin/env node
/**
 * Deploy BIND primary/secondary on Proxmox QEMU (rebuild) or configure-only on SSH hosts.
 *
 * Usage: hdc run service bind deploy -- [--instance a|b] [--destroy-existing] [--skip-provision] [--reboot]
 *   [--regenerate-tsig]  Generate a new TSIG secret and save to config.json + vault
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { fetchClusterVmResources } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { createProxmoxHostProvisioner } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { createBindVaultAccess } from "../lib/vault-deps.mjs";
import { resolveBindTsigSecret } from "../lib/bind-tsig.mjs";
import {
  bindGlobalSettings,
  normalizeBindConfig,
  resolveBindDeployments,
} from "../lib/deployments.mjs";
import { configureBind, createConfigureExec } from "../lib/bind-configure.mjs";
import { soaSerialFromTimestamp } from "../lib/bind-zones.mjs";
import {
  allocateNextVmid,
  applyQemuCloudInit,
  cloneQemuGuest,
  locateGuestByName,
  startQemuGuest,
  stopAndDestroyQemu,
  waitForSsh,
} from "../lib/proxmox-qemu-redeploy.mjs";
import { promptExistingGuestAction } from "../lib/prompt-existing.mjs";
import { ensureQemuGuestAgentForDeployment } from "../../../infrastructure/proxmox/lib/proxmox-qemu-guest-agent-for-deployment.mjs";
import { guestResourceOptsFromBlock } from "../../../infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import { waitForCloneTaskAndEnableAgent } from "../../../infrastructure/proxmox/lib/proxmox-qemu-post-clone.mjs";
import { bindReportExtraSections } from "../lib/bind-report.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import {
  growRootFilesystemInGuest,
  resizeQemuScsi0OnHypervisor,
  resolveRootfsGbFromDeployment,
  syncQemuRootfsOnMaintain,
} from "../../../lib/qemu-rootfs-resize.mjs";
import { resolvePveSshForHost } from "../../ollama/lib/ollama-install.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/bind/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, string>} flags
 */
function destroyPolicy(flags) {
  return flagGet(flags, "destroy-existing") !== undefined;
}

/**
 * @param {Record<string, string>} flags
 */
function skipProvision(flags) {
  return flagGet(flags, "skip-provision") !== undefined;
}

/**
 * @param {Record<string, string>} flags
 */
function existingGuestPolicy(flags) {
  if (flagGet(flags, "skip-existing") !== undefined) return "skip";
  if (flagGet(flags, "redeploy-existing") !== undefined) return "redeploy";
  if (destroyPolicy(flags)) return "destroy";
  return "prompt";
}

/**
 * @param {ReturnType<typeof bindGlobalSettings>} global
 * @param {ReturnType<typeof resolveBindDeployments>[number]} deployment
 * @param {string} tsigSecret
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
function runConfigure(deployment, global, tsigSecret, log) {
  const cfg = deployment.configure;
  const ssh = isObject(cfg) && isObject(cfg.ssh) ? cfg.ssh : {};
  const user = typeof ssh.user === "string" && ssh.user.trim() ? ssh.user.trim() : "root";
  const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : "";
  if (!host) {
    throw new Error(`${deployment.systemId}: configure.ssh.host required`);
  }
  const exec = createConfigureExec("ssh", { user, host });
  return configureBind({
    exec,
    log,
    role: deployment.role,
    zoneIds: global.zoneIds,
    zoneDefinitions: global.zoneDefinitions,
    primaryIp: global.primaryIp,
    secondaryIp: global.secondaryIp,
    hostmaster: global.hostmaster,
    tsigSecret,
    allowQueryCidrs: global.allowQueryCidrs,
    recursion: global.recursion,
    dnssecValidation: global.dnssecValidation,
    forwarders: global.forwarders,
    forwardUpstream: global.forwardUpstream,
    serial: deployment.role === "primary" ? soaSerialFromTimestamp() : undefined,
    repoRoot: root,
  });
}

/**
 * @typedef {ReturnType<typeof resolveBindDeployments>[number]} BindDeployment
 */

/**
 * @param {BindDeployment} deployment
 * @param {ReturnType<typeof bindGlobalSettings>} global
 */
function defaultSshHostForBind(deployment, global) {
  return deployment.role === "primary" ? global.primaryIp : global.secondaryIp;
}

/**
 * @param {BindDeployment} deployment
 * @param {ReturnType<typeof bindGlobalSettings>} global
 * @param {(line: string) => void} logLine
 */
async function ensureBindGuestAgent(deployment, global, logLine) {
  return ensureQemuGuestAgentForDeployment({
    proxmoxPackageRoot: proxmoxRoot,
    deployment,
    defaultSshHost: defaultSshHostForBind(deployment, global),
    log: logLine,
  });
}

/**
 * @param {BindDeployment} deployment
 * @param {Record<string, string>} flags
 * @param {ReturnType<typeof bindGlobalSettings>} global
 * @param {string} tsigSecret
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
async function deployOne(deployment, flags, global, tsigSecret, log) {
  const inv = deployTargetInventory(root, target, { systemIdOverride: deployment.systemId });
  logDeployInventoryStatus(target, verb, inv);

  if (skipProvision(flags) || deployment.mode === "configure-only") {
    errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} configure-only …\n`);
    const logLine = (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`);
    const guestAgent = await ensureBindGuestAgent(deployment, global, logLine);
    const configure = runConfigure(deployment, global, tsigSecret, log);
    return {
      ok: true,
      system_id: deployment.systemId,
      mode: "configure-only",
      guest_agent: guestAgent,
      configure,
    };
  }

  const px = deployment.proxmox;
  if (!isObject(px)) {
    return { ok: false, system_id: deployment.systemId, message: "missing proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) {
    return { ok: false, system_id: deployment.systemId, message: "missing host_id" };
  }
  const q = isObject(px.qemu) ? px.qemu : {};
  const net = isObject(px.network) ? px.network : {};
  const templateVmid = typeof q.template_vmid === "number" ? q.template_vmid : Number(q.template_vmid);
  const ip = typeof q.ip === "string" ? q.ip.trim() : "";
  const vmidStartRaw = typeof q.vmid_start === "number" ? q.vmid_start : Number(q.vmid_start);
  const vmidStart = Number.isFinite(vmidStartRaw) && vmidStartRaw > 0 ? vmidStartRaw : 100;
  const gateway =
    typeof net.gateway === "string" && net.gateway.trim()
      ? net.gateway.trim()
      : typeof q.gateway === "string"
        ? q.gateway.trim()
        : "192.0.2.1";
  const hostname =
    deployment.hostname ||
    (typeof q.name === "string" && q.name.trim() ? q.name.trim() : deployment.systemId.replace(/^vm-/, ""));

  if (!Number.isFinite(templateVmid) || templateVmid <= 0 || !ip) {
    return { ok: false, system_id: deployment.systemId, message: "invalid qemu template_vmid or ip" };
  }

  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
  let resources = await fetchClusterVmResources(
    auth.host.apiBase,
    auth.authorization,
    auth.rejectUnauthorized,
  );
  const locatedByName = locateGuestByName(resources, hostname);
  const policy = existingGuestPolicy(flags);

  if (locatedByName) {
    const { vmid: existingVmid, node, name } = locatedByName;
    errout.write(
      `[hdc] ${target} ${verb}: found existing guest ${name} (vmid ${existingVmid}) on ${node} …\n`,
    );
    let action = policy;
    if (policy === "prompt") {
      action = await promptExistingGuestAction(deployment.systemId, existingVmid, node, name);
    }
    if (action === "skip") {
      errout.write(`[hdc] ${target} ${verb}: skipping provision for ${deployment.systemId}.\n`);
      return { ok: true, system_id: deployment.systemId, skipped_provision: true, vmid: existingVmid };
    }
    if (action === "destroy" || policy === "destroy") {
      await stopAndDestroyQemu({
        apiBase: auth.host.apiBase,
        authorization: auth.authorization,
        rejectUnauthorized: auth.rejectUnauthorized,
        node,
        vmid: existingVmid,
        log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      });
      resources = await fetchClusterVmResources(
        auth.host.apiBase,
        auth.authorization,
        auth.rejectUnauthorized,
      );
    } else {
      errout.write(
        `[hdc] ${target} ${verb}: guest exists — configure only (use --destroy-existing to rebuild).\n`,
      );
      const logLine = (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`);
      const diskResize = await syncQemuRootfsOnMaintain({
        proxmoxPackageRoot: proxmoxRoot,
        deployment,
        flags,
        log: logLine,
      });
      const guestAgent = await ensureBindGuestAgent(deployment, global, logLine);
      const configure = runConfigure(deployment, global, tsigSecret, log);
      return {
        ok: true,
        system_id: deployment.systemId,
        role: deployment.role,
        skipped_provision: true,
        vmid: existingVmid,
        disk_resize: diskResize,
        guest_agent: guestAgent,
        configure,
      };
    }
  }

  const vmid = allocateNextVmid(resources, vmidStart);
  errout.write(
    `[hdc] ${target} ${verb}: ${deployment.systemId} (${deployment.role}) on ${hostId} — allocated vmid ${vmid}, static IP ${ip} …\n`,
  );

  const prov = createProxmoxHostProvisioner({
    apiBase: auth.host.apiBase,
    pveNode: auth.host.pveNode,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
  });

  const provisionResult = await cloneQemuGuest({
    log,
    provisioner: prov,
    name: hostname,
    vmid,
    templateVmid,
    parameters: { ...q, vmid, template_vmid: templateVmid },
  });

  if (!provisionResult.ok) {
    return {
      ok: false,
      system_id: deployment.systemId,
      role: deployment.role,
      provision: provisionResult,
    };
  }

  const { node: cloneNode, vmid: guestVmid } = await waitForCloneTaskAndEnableAgent(
    provisionResult,
    auth,
    vmid,
    (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    guestResourceOptsFromBlock(q, flags),
  );

  const rootfsGb = resolveRootfsGbFromDeployment(deployment);
  if (rootfsGb) {
    const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
    resizeQemuScsi0OnHypervisor({
      sshUser: pveSsh.user,
      sshHost: pveSsh.host,
      vmid: guestVmid,
      rootfsGb,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });
  }

  await applyQemuCloudInit({
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node: cloneNode,
    vmid: guestVmid,
    hostname,
    ipCidr: ip,
    gateway,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });

  await startQemuGuest({
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node: cloneNode,
    vmid: guestVmid,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });

  const sshCfg = isObject(deployment.configure) && isObject(deployment.configure.ssh)
    ? deployment.configure.ssh
    : {};
  const sshUser = typeof sshCfg.user === "string" && sshCfg.user.trim() ? sshCfg.user.trim() : "root";
  const sshHost = typeof sshCfg.host === "string" && sshCfg.host.trim() ? sshCfg.host.trim() : ip.split("/")[0];

  errout.write(
    `[hdc] ${target} ${verb}: waiting 45s for cloud-init on first boot before SSH probe …\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 45_000));
  errout.write(`[hdc] ${target} ${verb}: waiting for SSH on ${sshUser}@${sshHost} …\n`);
  await waitForSsh({ user: sshUser, host: sshHost });

  const logLine = (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`);
  if (rootfsGb) {
    const exec = createConfigureExec("ssh", { user: sshUser, host: sshHost });
    growRootFilesystemInGuest({ exec, log });
  }

  const guestAgent = await ensureBindGuestAgent(
    {
      ...deployment,
      configure: { ssh: { user: sshUser, host: sshHost } },
    },
    global,
    logLine,
  );

  const configure = runConfigure(
    {
      ...deployment,
      configure: { ssh: { user: sshUser, host: sshHost } },
    },
    global,
    tsigSecret,
    log,
  );

  return {
    ok: true,
    system_id: deployment.systemId,
    role: deployment.role,
    vmid: guestVmid,
    ip,
    provision: provisionResult,
    guest_agent: guestAgent,
    configure,
  };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: BIND DNS primary/secondary (stderr log; JSON on stdout).\n`);

  let cfg;
  let cfgPath;
  try {
    const loaded = ensurePackageConfig();
    cfg = loaded.data;
    cfgPath = loaded.path;
  } catch (e) {
    const inv = deployTargetInventory(root, target);
    logDeployInventoryStatus(target, verb, inv);
    errout.write(`[hdc] ${target} ${verb}: ${/** @type {Error} */ (e).message}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing — see stderr" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const flags = parseArgvFlags(process.argv.slice(2));
  let normalized;
  let deployments;
  try {
    normalized = normalizeBindConfig(cfg);
    deployments = resolveBindDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const global = bindGlobalSettings(normalized);
  const vault = createBindVaultAccess();
  const regenerateTsig = flagGet(flags, "regenerate-tsig") !== undefined;
  errout.write(`[hdc] ${target} ${verb}: resolving TSIG secret (key ${global.tsigVaultKey}) …\n`);
  let tsigSecret;
  try {
    tsigSecret = await resolveBindTsigSecret({
      cfgPath,
      cfg,
      global,
      vault,
      regenerate: regenerateTsig,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: TSIG resolution failed: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  if (deployments.length > 1) {
    errout.write(`[hdc] ${target} ${verb}: deploying ${deployments.length} instance(s) (primary first) …\n`);
  }

  const log = provisionLogFromConsole(console);
  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const deployment of deployments) {
    try {
      results.push(await deployOne(deployment, flags, global, tsigSecret, log));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      results.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  const ok = results.every((r) => r.ok);
  const payload = { ok, target, verb, count: results.length, results };
  runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    extraSections: bindReportExtraSections,
  });
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
