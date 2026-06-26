#!/usr/bin/env node
/**
 * Deploy Audiobookshelf on Proxmox QEMU (Docker Compose + optional data disk).
 *
 * Usage: hdc run service audiobookshelf deploy -- [--instance a | --system-id vm-audiobookshelf-a]
 *        hdc run service audiobookshelf deploy -- [--skip-install] [--skip-existing | --redeploy-existing | --destroy-existing]
 *        hdc run service audiobookshelf deploy -- [--skip-provision]
 */
import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { guestResourceOptsFromBlock } from "../../../infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import { createProxmoxHostProvisioner } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { ensureQemuGuestAgentOnDeploy } from "../../../infrastructure/proxmox/lib/proxmox-qemu-guest-agent-install.mjs";
import { waitForCloneTaskAndEnableAgent } from "../../../infrastructure/proxmox/lib/proxmox-qemu-post-clone.mjs";
import { sshRemote } from "../../../lib/pve-pct-remote.mjs";
import { createConfigureExec } from "../../postfix-relay/lib/postfix-relay-configure.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

import {
  dataDiskGbFromDeployment,
  dataDiskStorageFromDeployment,
  resolveAudiobookshelfDeployments,
} from "../lib/deployments.mjs";
import { installAudiobookshelfOnHost, resolvePveSshForHost } from "../lib/audiobookshelf-install.mjs";
import { resolvePublicUrl, resolveUpstreamUrl } from "../lib/audiobookshelf-render.mjs";
import { attachQemuDataDisk } from "../lib/proxmox-data-disk.mjs";
import {
  applyQemuCloudInit,
  cloneQemuGuest,
  locateGuest,
  startQemuGuest,
  stopAndDestroyQemu,
  waitForQemuGuestSshAfterBoot,
} from "../lib/proxmox-qemu-redeploy.mjs";
import { pveFormBody, pveJsonRequest, pveData, waitForPveTask } from "../../../infrastructure/proxmox/lib/pve-http.mjs";
import { extractPveUpid } from "../../../infrastructure/proxmox/lib/proxmox-qemu-post-clone.mjs";
import { promptExistingGuestAction } from "../lib/prompt-existing.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/audiobookshelf/config.example.json";
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

function readCfg() {
  return ensurePackageConfig().data;
}

/**
 * @param {Record<string, unknown>} install
 */
function shouldInstall(install) {
  return install.enabled !== false;
}

/**
 * @param {Record<string, string>} flags
 */
function existingGuestPolicy(flags) {
  if (flagGet(flags, "skip-existing") !== undefined) return "skip";
  if (flagGet(flags, "redeploy-existing") !== undefined) return "redeploy";
  if (flagGet(flags, "destroy-existing") !== undefined) return "destroy";
  return "prompt";
}

/**
 * @param {Record<string, string>} flags
 */
function skipProvision(flags) {
  return flagGet(flags, "skip-provision") !== undefined;
}

/**
 * @param {ReturnType<typeof resolveAudiobookshelfDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 */
async function runConfigure(deployment, flags) {
  const { systemId, audiobookshelf, install, configure } = deployment;
  const absCfg = isObject(audiobookshelf) ? audiobookshelf : {};
  const installCfg = isObject(install) ? install : {};

  if (!shouldInstall(installCfg)) {
    errout.write(`[hdc] ${target} ${verb}: ${systemId} install disabled � skipping configure.\n`);
    return { ok: true, skipped: true, message: "install disabled" };
  }

  const cfg = isObject(configure) ? configure : {};
  const ssh = isObject(cfg.ssh) ? cfg.ssh : {};
  const user = resolveGuestSshUser(ssh.user);
  const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : "";
  if (!host) {
    throw new Error(`${systemId}: configure.ssh.host required`);
  }
  const exec = createConfigureExec("ssh", { user, host });
  const dataDiskGb = dataDiskGbFromDeployment(deployment);
  return installAudiobookshelfOnHost(exec, absCfg, installCfg, dataDiskGb);
}

/**
 * @param {ReturnType<typeof resolveAudiobookshelfDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
async function deployQemuOne(deployment, flags, log) {
  const { systemId, audiobookshelf, install } = deployment;

  if (skipProvision(flags) || deployment.mode === "configure-only") {
    errout.write(`[hdc] ${target} ${verb}: ${systemId} configure-only �\n`);
    const configure = await runConfigure(deployment, flags);
    const absCfg = isObject(audiobookshelf) ? audiobookshelf : {};
    const sshHost =
      isObject(deployment.configure) &&
      isObject(deployment.configure.ssh) &&
      typeof deployment.configure.ssh.host === "string"
        ? deployment.configure.ssh.host.trim()
        : null;
    return {
      ok: configure.ok !== false,
      system_id: systemId,
      mode: deployment.mode,
      configure,
      public_url: resolvePublicUrl(absCfg),
      upstream_url: resolveUpstreamUrl(sshHost, absCfg),
    };
  }

  const px = deployment.proxmox;
  if (!isObject(px)) {
    return { ok: false, system_id: systemId, message: "missing proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) {
    return { ok: false, system_id: systemId, message: "missing host_id" };
  }
  const q = isObject(px.qemu) ? px.qemu : {};
  const net = isObject(px.network) ? px.network : {};
  const vmid = typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
  const templateVmid = typeof q.template_vmid === "number" ? q.template_vmid : Number(q.template_vmid);
  const ip = typeof q.ip === "string" ? q.ip.trim() : "";
  const gateway =
    typeof net.gateway === "string" && net.gateway.trim()
      ? net.gateway.trim()
      : typeof q.gateway === "string"
        ? q.gateway.trim()
        : "10.0.0.1";
  const hostname =
    deployment.hostname ||
    (typeof q.name === "string" && q.name.trim() ? q.name.trim() : systemId.replace(/^vm-/, ""));
  const dataDiskGb = dataDiskGbFromDeployment(deployment);
  const dataDiskStorage = dataDiskStorageFromDeployment(deployment);
  const rootfsGb = typeof q.rootfs_gb === "number" ? q.rootfs_gb : Number(q.rootfs_gb);

  if (!Number.isFinite(vmid) || vmid <= 0 || !Number.isFinite(templateVmid) || templateVmid <= 0 || !ip) {
    return { ok: false, system_id: systemId, message: "invalid qemu vmid, template_vmid, or ip" };
  }

  errout.write(`[hdc] ${target} ${verb}: ${systemId} on ${hostId} vmid ${vmid} (QEMU) �\n`);
  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
  const located = await locateGuest(auth.host.apiBase, auth.authorization, auth.rejectUnauthorized, vmid);
  const policy = existingGuestPolicy(flags);

  if (located) {
    let action = policy;
    if (policy === "prompt") {
      action = await promptExistingGuestAction(systemId, vmid, located.node, located.name);
    }
    if (action === "skip") {
      errout.write(`[hdc] ${target} ${verb}: skipping provision for ${systemId}.\n`);
      return { ok: true, system_id: systemId, skipped_provision: true };
    }
    if (action === "destroy" || policy === "destroy") {
      await stopAndDestroyQemu({
        apiBase: auth.host.apiBase,
        authorization: auth.authorization,
        rejectUnauthorized: auth.rejectUnauthorized,
        node: located.node,
        vmid,
        log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      });
    } else {
      errout.write(
        `[hdc] ${target} ${verb}: guest exists � configure only (use --destroy-existing to rebuild).\n`,
      );
      const configure = await runConfigure(deployment, flags);
      const absCfg = isObject(audiobookshelf) ? audiobookshelf : {};
      return {
        ok: configure.ok !== false,
        system_id: systemId,
        skipped_provision: true,
        configure,
        public_url: resolvePublicUrl(absCfg),
        upstream_url: configure.upstream_url ?? resolveUpstreamUrl(ip.split("/")[0], absCfg),
      };
    }
  }

  const prov = createProxmoxHostProvisioner({
    apiBase: auth.host.apiBase,
    pveNode: auth.host.pveNode,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    packageId: target,
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
      system_id: systemId,
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

  if (Number.isFinite(rootfsGb) && rootfsGb > 0) {
    const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
    errout.write(
      `[hdc] ${target} ${verb}: resizing scsi0 to ${rootfsGb}G on vmid ${guestVmid} (node ${cloneNode}) �\n`,
    );
    const resizeBody = await pveJsonRequest(
      "PUT",
      auth.host.apiBase,
      `/nodes/${encodeURIComponent(cloneNode)}/qemu/${encodeURIComponent(String(guestVmid))}/resize`,
      auth.authorization,
      auth.rejectUnauthorized,
      pveFormBody({ disk: "scsi0", size: `${rootfsGb}G` }),
    );
    const resizeUpid = extractPveUpid(pveData(resizeBody));
    if (resizeUpid) {
      await waitForPveTask({
        apiBase: auth.host.apiBase,
        node: cloneNode,
        upid: resizeUpid,
        authorization: auth.authorization,
        rejectUnauthorized: auth.rejectUnauthorized,
        timeoutMs: 300_000,
        log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      });
    }
  }

  if (dataDiskGb > 0) {
    await attachQemuDataDisk({
      apiBase: auth.host.apiBase,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
      node: cloneNode,
      vmid: guestVmid,
      storage: dataDiskStorage,
      sizeGb: dataDiskGb,
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
  let sshUser = resolveGuestSshUser(sshCfg.user);
  const sshHost = typeof sshCfg.host === "string" && sshCfg.host.trim() ? sshCfg.host.trim() : ip.split("/")[0];

  const sshWait = await waitForQemuGuestSshAfterBoot({
    user: sshUser,
    host: sshHost,
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node: cloneNode,
    vmid: guestVmid,
    freshClone: true,
    proxmoxPackageRoot: proxmoxRoot,
    flags,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });
  sshUser = sshWait.user;


  await ensureQemuGuestAgentOnDeploy({
    apiBase: auth.host.apiBase,
    node: cloneNode,
    vmid: guestVmid,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    sshUser,
    sshHost,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });

  const configure = await runConfigure(
    {
      ...deployment,
      configure: { ssh: { user: sshUser, host: sshHost } },
    },
    flags,
  );

  const absCfg = isObject(audiobookshelf) ? audiobookshelf : {};
  return {
    ok: configure.ok !== false,
    system_id: systemId,
    mode: "proxmox-qemu",
    ip: sshHost,
    public_url: resolvePublicUrl(absCfg),
    upstream_url: configure.upstream_url ?? resolveUpstreamUrl(sshHost, absCfg),
    provision: provisionResult,
    configure,
  };
}

/**
 * @param {ReturnType<typeof resolveAudiobookshelfDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
async function deployOne(deployment, flags, log) {
  const inv = deployTargetInventory(root, target, { systemIdOverride: deployment.systemId });
  logDeployInventoryStatus(target, verb, inv);

  if (deployment.mode === "proxmox-qemu" || deployment.mode === "configure-only") {
    return deployQemuOne(deployment, flags, log);
  }
  return { ok: false, system_id: deployment.systemId, message: `unsupported mode ${deployment.mode}` };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Audiobookshelf via Proxmox QEMU (stderr log; JSON on stdout).\n`);

  if (!existsSync(ensurePackageConfig().path)) {
    const inv = deployTargetInventory(root, target);
    logDeployInventoryStatus(target, verb, inv);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing � see stderr" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const log = provisionLogFromConsole(console);
  let deployments;
  try {
    deployments = resolveAudiobookshelfDeployments(cfg, flags);
  } catch (e) {
    errout.write(`[hdc] ${target} ${verb}: ${/** @type {Error} */ (e).message}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const deployment of deployments) {
    try {
      results.push(await deployOne(deployment, flags, log));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      results.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  const ok = results.every((r) => r.ok !== false);
  const payload = { ok, target, verb, count: results.length, results };
  runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
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
