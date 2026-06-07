import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
#!/usr/bin/env node
/**
 * Deploy nginx WAF nodes: optional Proxmox QEMU provision, base install, sites, certs, peer sync.
 *
 * Usage: hdc run service nginx-waf deploy -- [--instance a|b] [--skip-provision] [--destroy-existing]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { isProxmoxHostDown } from "../../../infrastructure/proxmox/lib/proxmox-config.mjs";
import { loadProxmoxPackageConfig } from "../../../infrastructure/proxmox/lib/proxmox-package-config.mjs";
import { createProxmoxHostProvisioner } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import {
  fetchClusterVmResources,
} from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { pveJsonRequest } from "../../../infrastructure/proxmox/lib/pve-http.mjs";
import { ensureQemuGuestAgentForDeployment } from "../../../infrastructure/proxmox/lib/proxmox-qemu-guest-agent-for-deployment.mjs";
import { guestResourceOptsFromBlock } from "../../../infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import { waitForCloneTaskAndEnableAgent } from "../../../infrastructure/proxmox/lib/proxmox-qemu-post-clone.mjs";
import { createNginxWafVaultAccess } from "../lib/vault-deps.mjs";
import {
  findCertPrimaryDeployment,
  findPeerDeployment,
  nginxWafGlobalSettings,
  normalizeNginxWafConfig,
  resolveNginxWafDeployments,
  sshTargetFromDeployment,
} from "../lib/deployments.mjs";
import { configureNginxWaf, createConfigureExec } from "../lib/nginx-waf-configure.mjs";
import { installCertSyncOnPrimary, runCertSync } from "../lib/cert-sync.mjs";
import { obtainMissingCertificates } from "../lib/letsencrypt.mjs";
import {
  applyQemuCloudInit,
  cloneQemuGuest,
  locateGuest,
  startQemuGuest,
  stopAndDestroyQemu,
  stopQemuGuest,
  waitForQemuGuestSshAfterBoot,
} from "../lib/proxmox-qemu-redeploy.mjs";
import { promptExistingGuestAction } from "../lib/prompt-existing.mjs";
import { nginxWafReportExtraSections } from "../lib/nginx-waf-report.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/nginx-waf/config.example.json";
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
function skipInstall(flags) {
  return flagGet(flags, "skip-install") !== undefined;
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
 * @param {ReturnType<typeof resolveNginxWafDeployments>[number]} deployment
 * @param {ReturnType<typeof nginxWafGlobalSettings>} global
 * @param {Record<string, unknown>[]} sites
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 * @param {boolean} skipBaseInstall
 */
function runConfigure(deployment, global, sites, log, skipBaseInstall) {
  const { user, host } = sshTargetFromDeployment(deployment);
  const exec = createConfigureExec("ssh", { user, host });
  return configureNginxWaf({
    exec,
    log,
    global,
    sites,
    skipBaseInstall,
    wafNodeId: deployment.systemId,
  });
}

/**
 * @param {Awaited<ReturnType<typeof authorizeProxmoxForHost>>} auth
 * @param {number} vmid
 * @param {string} [hostId]
 * @param {(line: string) => void} logLine
 */
/**
 * @param {Awaited<ReturnType<typeof authorizeProxmoxForHost>>} auth
 * @param {number} vmid
 * @param {number} [timeoutMs]
 */
/**
 * @param {Awaited<ReturnType<typeof authorizeProxmoxForHost>>} auth
 * @param {string} node
 * @param {number} vmid
 * @param {(line: string) => void} logLine
 */
async function destroyOrphanQemuConfig(auth, node, vmid, logLine) {
  try {
    await pveJsonRequest(
      "GET",
      auth.host.apiBase,
      `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/config`,
      auth.authorization,
      auth.rejectUnauthorized,
      undefined,
    );
    errout.write(
      `[hdc] ${target} ${verb}: orphan config for vmid ${vmid} on ${node} — destroying …\n`,
    );
    await stopAndDestroyQemu({
      apiBase: auth.host.apiBase,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
      node,
      vmid,
      log: logLine,
    });
  } catch {
    /* no config on this node */
  }
}

async function waitUntilGuestAbsent(auth, vmid, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const located = await locateGuest(
      auth.host.apiBase,
      auth.authorization,
      auth.rejectUnauthorized,
      vmid,
    );
    if (!located) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`vmid ${vmid} still present in cluster after destroy (waited ${timeoutMs}ms)`);
}

async function destroyQemuVmidInCluster(auth, vmid, hostId, logLine) {
  const nodes = new Set();
  if (auth.host.pveNode) nodes.add(auth.host.pveNode);
  if (hostId === "pve-c") nodes.add("pve-b");
  try {
    const resources = await fetchClusterVmResources(
      auth.host.apiBase,
      auth.authorization,
      auth.rejectUnauthorized,
    );
    for (const r of resources) {
      if (typeof r.vmid === "number" && r.vmid === vmid && typeof r.node === "string" && r.node.trim()) {
        nodes.add(r.node.trim());
      }
    }
  } catch (e) {
    errout.write(
      `[hdc] ${target} ${verb}: cluster resource scan for vmid ${vmid}: ${String(/** @type {Error} */ (e).message || e)}\n`,
    );
  }
  try {
    const { data } = loadProxmoxPackageConfig(proxmoxRoot);
    const clusters = Array.isArray(data.clusters) ? data.clusters : [];
    for (const cl of clusters) {
      if (!cl || typeof cl !== "object" || Array.isArray(cl)) continue;
      const hosts = Array.isArray(/** @type {Record<string, unknown>} */ (cl).hosts)
        ? /** @type {Record<string, unknown>[]} */ (/** @type {Record<string, unknown>} */ (cl).hosts)
        : [];
      for (const h of hosts) {
        if (isProxmoxHostDown(h)) continue;
        const pveNode =
          typeof h.pve_node === "string" && h.pve_node.trim()
            ? h.pve_node.trim()
            : typeof h.id === "string"
              ? h.id.trim()
              : "";
        if (pveNode) nodes.add(pveNode);
      }
    }
  } catch {
    /* optional */
  }
  for (const node of nodes) {
    try {
      await stopAndDestroyQemu({
        apiBase: auth.host.apiBase,
        authorization: auth.authorization,
        rejectUnauthorized: auth.rejectUnauthorized,
        node,
        vmid,
        log: logLine,
      });
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: destroy vmid ${vmid} on ${node}: ${msg} (continuing)\n`);
    }
    await destroyOrphanQemuConfig(auth, node, vmid, logLine);
  }
}

/**
 * @param {Awaited<ReturnType<typeof authorizeProxmoxForHost>>} auth
 * @param {string} node
 * @param {number} vmid
 * @param {string} hostname
 * @param {string} ipCidr
 * @param {string} gateway
 * @param {ReturnType<typeof resolveNginxWafDeployments>[number]} deployment
 * @param {(line: string) => void} logLine
 */
async function bootstrapGuestNetworkAndSsh(
  auth,
  node,
  vmid,
  hostname,
  ipCidr,
  gateway,
  deployment,
  logLine,
  flags,
) {
  await stopQemuGuest({
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node,
    vmid,
    log: logLine,
  });
  await applyQemuCloudInit({
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node,
    vmid,
    hostname,
    ipCidr,
    gateway,
    log: logLine,
  });
  await startQemuGuest({
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node,
    vmid,
    log: logLine,
  });
  const sshCfg = isObject(deployment.configure) && isObject(deployment.configure.ssh)
    ? deployment.configure.ssh
    : {};
  let sshUser = resolveGuestSshUser(sshCfg.user);
  const sshHost = typeof sshCfg.host === "string" && sshCfg.host.trim() ? sshCfg.host.trim() : ipCidr.split("/")[0];
  const sshWait = await waitForQemuGuestSshAfterBoot({
    user: sshUser,
    host: sshHost,
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node,
    vmid,
    freshClone: true,
    proxmoxPackageRoot: proxmoxRoot,
    flags,
    log: logLine,
  });
  return { user: sshWait.user, host: sshHost };
}

/**
 * @param {ReturnType<typeof resolveNginxWafDeployments>[number]} deployment
 */
function defaultSshHostForNginxWaf(deployment) {
  const px = deployment.proxmox;
  if (isObject(px)) {
    const q = isObject(px.qemu) ? px.qemu : {};
    const ip = typeof q.ip === "string" ? q.ip.trim() : "";
    if (ip) return ip.split("/")[0];
  }
  try {
    return sshTargetFromDeployment(deployment).host;
  } catch {
    return "";
  }
}

/**
 * @param {ReturnType<typeof resolveNginxWafDeployments>[number]} deployment
 * @param {(line: string) => void} logLine
 */
async function ensureNginxWafGuestAgent(deployment, logLine) {
  return ensureQemuGuestAgentForDeployment({
    proxmoxPackageRoot: proxmoxRoot,
    deployment,
    defaultSshHost: defaultSshHostForNginxWaf(deployment),
    log: logLine,
  });
}

/**
 * @param {ReturnType<typeof resolveNginxWafDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {ReturnType<typeof nginxWafGlobalSettings>} global
 * @param {Record<string, unknown>[]} sites
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
async function deployOne(deployment, flags, global, sites, log) {
  const inv = deployTargetInventory(root, target, { systemIdOverride: deployment.systemId });
  logDeployInventoryStatus(target, verb, inv);

  const skipBase = skipInstall(flags) || !deployment.installEnabled;

  if (skipProvision(flags) || deployment.mode === "configure-only") {
    errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} configure-only …\n`);
    const logLine = (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`);
    const guestAgent = await ensureNginxWafGuestAgent(deployment, logLine);
    const configure = runConfigure(deployment, global, sites, log, skipBase);
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
  const vmid = typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
  const templateVmid = typeof q.template_vmid === "number" ? q.template_vmid : Number(q.template_vmid);
  const ip = typeof q.ip === "string" ? q.ip.trim() : "";
  const gateway =
    typeof net.gateway === "string" && net.gateway.trim()
      ? net.gateway.trim()
      : typeof q.gateway === "string"
        ? q.gateway.trim()
        : "192.0.2.1";
  const hostname =
    deployment.hostname ||
    (typeof q.name === "string" && q.name.trim() ? q.name.trim() : deployment.systemId.replace(/^vm-/, ""));

  if (!Number.isFinite(vmid) || vmid <= 0 || !Number.isFinite(templateVmid) || templateVmid <= 0 || !ip) {
    return { ok: false, system_id: deployment.systemId, message: "invalid qemu vmid, template_vmid, or ip" };
  }

  errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} (${deployment.role}) on ${hostId} vmid ${vmid} …\n`);
  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
  const located = await locateGuest(auth.host.apiBase, auth.authorization, auth.rejectUnauthorized, vmid);
  const policy = existingGuestPolicy(flags);

  if (located) {
    let action = policy;
    if (policy === "prompt") {
      action = await promptExistingGuestAction(
        deployment.systemId,
        vmid,
        located.node,
        located.name,
      );
    }
    if (action === "skip") {
      errout.write(`[hdc] ${target} ${verb}: skipping provision for ${deployment.systemId}.\n`);
      return { ok: true, system_id: deployment.systemId, role: deployment.role, skipped_provision: true };
    }
    if (action === "destroy" || policy === "destroy") {
      await destroyQemuVmidInCluster(auth, vmid, hostId, (line) =>
        errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      );
      await waitUntilGuestAbsent(auth, vmid);
    } else {
      errout.write(
        `[hdc] ${target} ${verb}: guest exists — re-apply cloud-init and configure (use --destroy-existing to rebuild).\n`,
      );
      const logLine = (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`);
      await bootstrapGuestNetworkAndSsh(
        auth,
        located.node,
        vmid,
        hostname,
        ip,
        gateway,
        deployment,
        logLine,
        flags,
      );
      const guestAgent = await ensureNginxWafGuestAgent(deployment, logLine);
      const configure = runConfigure(deployment, global, sites, log, skipBase);
      return {
        ok: true,
        system_id: deployment.systemId,
        role: deployment.role,
        skipped_provision: true,
        guest_agent: guestAgent,
        configure,
      };
    }
  } else if (policy === "destroy") {
    await destroyQemuVmidInCluster(auth, vmid, hostId, (line) =>
      errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    );
    await waitUntilGuestAbsent(auth, vmid);
  }

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

  const logLine = (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`);
  const sshTarget = await bootstrapGuestNetworkAndSsh(
    auth,
    cloneNode,
    guestVmid,
    hostname,
    ip,
    gateway,
    deployment,
    logLine,
    flags,
  );

  const guestAgent = await ensureNginxWafGuestAgent(
    {
      ...deployment,
      configure: { ssh: { user: sshTarget.user, host: sshTarget.host } },
    },
    logLine,
  );

  const configure = runConfigure(
    {
      ...deployment,
      configure: { ssh: { user: sshUser, host: sshHost } },
    },
    global,
    sites,
    log,
    skipBase,
  );

  return {
    ok: true,
    system_id: deployment.systemId,
    role: deployment.role,
    provision: provisionResult,
    guest_agent: guestAgent,
    configure,
  };
}

/**
 * @param {string} email
 * @param {ReturnType<typeof nginxWafGlobalSettings>} global
 * @param {Awaited<ReturnType<typeof createNginxWafVaultAccess>>} vault
 */
async function loadSecrets(email, global, vault) {
  let leEmail = global.email;
  if (!leEmail) {
    leEmail = String(
      await vault.getSecret(global.emailVaultKey, {
        promptLabel: `vault secret ${global.emailVaultKey}`,
      }),
    ).trim();
  }
  let tsigSecret = "";
  if (global.challenge === "dns-01") {
    tsigSecret = String(
      await vault.getSecret(global.dnsTsigVaultKey, {
        promptLabel: `vault secret ${global.dnsTsigVaultKey}`,
      }),
    ).trim();
  }
  return { email: leEmail, tsigSecret };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: nginx WAF reverse proxy (stderr log; JSON on stdout).\n`);

  if (!existsSync(ensurePackageConfig().path)) {
    const inv = deployTargetInventory(root, target);
    logDeployInventoryStatus(target, verb, inv);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing — see stderr" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  let normalized;
  let deployments;
  try {
    normalized = normalizeNginxWafConfig(cfg);
    deployments = resolveNginxWafDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const global = nginxWafGlobalSettings(normalized);
  const sites = /** @type {Record<string, unknown>[]} */ (global.sites);

  const vault = createNginxWafVaultAccess();
  errout.write(`[hdc] ${target} ${verb}: unlocking vault …\n`);
  await vault.unlock({});
  const { email, tsigSecret } = await loadSecrets("", global, vault);
  if (!email) {
    errout.write(
      `[hdc] ${target} ${verb}: Let's Encrypt email missing — set letsencrypt.email or hdc secrets set ${global.emailVaultKey}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "missing Let's Encrypt email" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const log = provisionLogFromConsole(console);
  /** @type {Record<string, unknown>[]} */
  const results = [];

  for (const deployment of deployments) {
    try {
      results.push(await deployOne(deployment, flags, global, sites, log));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      results.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  const allDeployments = resolveNginxWafDeployments(cfg, {});
  const primary = findCertPrimaryDeployment(allDeployments, global.certPrimarySystemId);
  const peer = findPeerDeployment(allDeployments, primary);
  const primaryTarget = sshTargetFromDeployment(primary);
  const primaryExec = createConfigureExec("ssh", primaryTarget);

  try {
    if (primary.role === "cert-primary" && !skipInstall(flags)) {
      installCertSyncOnPrimary({ primary, peer, primaryExec, log });
    }
    const certResult = obtainMissingCertificates({
      exec: primaryExec,
      log,
      global,
      email,
      sites,
      tsigSecret,
    });
    runCertSync(primaryExec, log);
    results.push({
      ok: true,
      system_id: primary.systemId,
      step: "certificates",
      certificates: certResult,
      synced_to: peer.systemId,
    });
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: certificate step failed: ${msg}\n`);
    results.push({ ok: false, system_id: primary.systemId, step: "certificates", message: msg });
  }

  const ok = results.every((r) => r.ok === true);
  const payload = { ok, target, verb, count: results.length, results };
  runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    extraSections: nginxWafReportExtraSections,
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
