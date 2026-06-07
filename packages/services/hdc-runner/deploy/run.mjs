#!/usr/bin/env node
/**
 * Deploy hdc-runner on Proxmox LXC or QEMU.
 *
 * Usage: hdc run service hdc-runner deploy -- [--instance a] [--skip-install]
 *        [--skip-existing | --redeploy-existing] [--destroy-existing] [--skip-provision]
 */
import { lxcHostnameFromSystemId } from "../../../../tools/hdc/lib/inventory-naming.mjs";
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
import { waitForLxcCreateTaskAndApplyResources } from "../../../infrastructure/proxmox/lib/proxmox-lxc-post-create.mjs";
import { ensureLxcStarted } from "../../../infrastructure/proxmox/lib/proxmox-lxc-start.mjs";
import { createProxmoxHostProvisioner } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { stopAndDestroyLxc } from "../../../infrastructure/proxmox/lib/proxmox-guest-destroy.mjs";
import { ensureQemuGuestAgentOnDeploy } from "../../../infrastructure/proxmox/lib/proxmox-qemu-guest-agent-install.mjs";
import { waitForCloneTaskAndEnableAgent } from "../../../infrastructure/proxmox/lib/proxmox-qemu-post-clone.mjs";
import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
import {
  resizeQemuScsi0OnHypervisor,
  resolveRootfsGbFromDeployment,
} from "../../../lib/qemu-rootfs-resize.mjs";
import {
  applyQemuCloudInit,
  cloneQemuGuest,
  locateGuest,
  startQemuGuest,
  stopAndDestroyQemu,
  waitForQemuGuestSshAfterBoot,
} from "../../step-ca/lib/proxmox-qemu-redeploy.mjs";
import { resolveLxcRootPassword } from "../../ollama/lib/lxc-password.mjs";
import { resolvePveSshForHost } from "../../gatus/lib/gatus-install.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

import { resolveHdcRunnerDeployments } from "../lib/deployments.mjs";
import { findClusterGuest } from "../lib/guest-exists.mjs";
import { promptExistingGuestAction } from "../lib/prompt-existing.mjs";
import { applyHdcRunnerOnDeployment } from "../lib/hdc-runner-operate.mjs";
import { createHdcRunnerVaultAccess } from "../lib/vault-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/hdc-runner/config.example.json";
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

function shouldInstall(install) {
  return install.enabled !== false;
}

function existingGuestPolicy(flags) {
  if (flagGet(flags, "skip-existing") !== undefined) return "skip";
  if (flagGet(flags, "redeploy-existing") !== undefined) return "redeploy";
  if (flagGet(flags, "destroy-existing") !== undefined) return "destroy";
  return "prompt";
}

/**
 * @param {ReturnType<typeof resolveHdcRunnerDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {{ ctPasswordCache?: { value: string | null } }} runOpts
 */
async function deployLxc(deployment, flags, runOpts) {
  const { mode, systemId, proxmox: px, install } = deployment;
  if (!isObject(px)) {
    return { ok: false, system_id: systemId, message: "bad proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) return { ok: false, system_id: systemId, message: "missing host_id" };

  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
  const lxc = isObject(px.lxc) ? px.lxc : {};
  const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
  if (!Number.isFinite(vmid) || vmid <= 0) {
    return { ok: false, system_id: systemId, message: "invalid vmid" };
  }

  let located = await findClusterGuest(
    auth.host.apiBase,
    auth.authorization,
    auth.rejectUnauthorized,
    vmid,
  );

  let skipProvision = false;
  if (located) {
    const policy = existingGuestPolicy(flags);
    let action = policy;
    if (policy === "prompt") {
      action = await promptExistingGuestAction(systemId, vmid, located.node, located.name);
    }
    if (action === "destroy") {
      await stopAndDestroyLxc({
        apiBase: auth.host.apiBase,
        authorization: auth.authorization,
        rejectUnauthorized: auth.rejectUnauthorized,
        node: located.node,
        vmid,
        log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      });
      located = null;
    } else if (action === "skip") {
      return { ok: true, system_id: systemId, skipped: true, message: "guest already exists" };
    } else {
      skipProvision = true;
    }
  }

  const log = provisionLogFromConsole(console);
  /** @type {import("../../../lib/host-provisioner.mjs").ProvisionResult | null} */
  let provisionResult = null;

  if (!skipProvision) {
    const prov = createProxmoxHostProvisioner({
      apiBase: auth.host.apiBase,
      pveNode: auth.host.pveNode,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
    });
    const hostname =
      (typeof lxc.hostname === "string" && lxc.hostname.trim()) ||
      lxcHostnameFromSystemId(systemId) ||
      "hdc-runner";
    const memoryMb = typeof lxc.memory_mb === "number" ? lxc.memory_mb : Number(lxc.memory_mb);
    const cores = typeof lxc.cores === "number" ? lxc.cores : Number(lxc.cores);
    const diskGb = typeof lxc.rootfs_gb === "number" ? lxc.rootfs_gb : Number(lxc.rootfs_gb);
    const cache = runOpts.ctPasswordCache ?? { value: null };
    const rootPassword = await resolveLxcRootPassword(systemId, vmid, lxc, flags, {
      cached: cache.value,
      setCached: (v) => {
        cache.value = v;
      },
    });
    provisionResult = await prov.createContainer(log, {
      name: hostname,
      memoryMb,
      cores,
      diskGb,
      parameters: { ...lxc, password: rootPassword },
    });
    if (!provisionResult.ok) {
      return { ok: false, system_id: systemId, provision: provisionResult };
    }
  }

  await waitForLxcCreateTaskAndApplyResources(
    provisionResult ?? { ok: true, details: { vmid, node: located?.node } },
    auth,
    vmid,
    (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    guestResourceOptsFromBlock(lxc, flags),
  );

  const lxcNode =
    (typeof provisionResult?.details?.node === "string" && provisionResult.details.node.trim()) ||
    located?.node ||
    auth.host.pveNode;

  if (shouldInstall(install)) {
    await ensureLxcStarted({
      apiBase: auth.host.apiBase,
      node: lxcNode,
      vmid,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });
  }

  return { ok: true, system_id: systemId, host_id: hostId, vmid, mode };
}

/**
 * @param {ReturnType<typeof resolveHdcRunnerDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 */
async function deployQemu(deployment, flags) {
  const { systemId, proxmox: px, install } = deployment;
  if (!isObject(px)) return { ok: false, system_id: systemId, message: "bad proxmox config" };
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  const q = isObject(px.qemu) ? px.qemu : {};
  const net = isObject(px.network) ? px.network : {};
  const vmid = typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
  const templateVmid = typeof q.template_vmid === "number" ? q.template_vmid : Number(q.template_vmid);
  const ip = typeof q.ip === "string" ? q.ip.trim() : "";
  const gateway =
    typeof net.gateway === "string" && net.gateway.trim() ? net.gateway.trim() : "10.0.0.1";
  if (!hostId || !Number.isFinite(vmid) || vmid <= 0 || !Number.isFinite(templateVmid) || !ip) {
    return { ok: false, system_id: systemId, message: "invalid qemu vmid, template_vmid, or ip" };
  }

  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
  const log = provisionLogFromConsole(console);
  const located = await locateGuest(auth.host.apiBase, auth.authorization, auth.rejectUnauthorized, vmid);
  const policy = existingGuestPolicy(flags);

  if (located) {
    let action = policy;
    if (policy === "prompt") {
      action = await promptExistingGuestAction(systemId, vmid, located.node, located.name);
    }
    if (action === "skip") {
      return { ok: true, system_id: systemId, skipped: true, message: "guest exists" };
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
      return { ok: true, system_id: systemId, host_id: hostId, vmid, mode: "proxmox-qemu" };
    }
  }

  if (flagGet(flags, "skip-provision") !== undefined) {
    return { ok: true, system_id: systemId, skipped_provision: true };
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
    name: systemId.replace(/^vm-/, ""),
    vmid,
    templateVmid,
    parameters: { ...q, vmid, template_vmid: templateVmid },
  });
  if (!provisionResult.ok) {
    return { ok: false, system_id: systemId, provision: provisionResult };
  }

  const { node: cloneNode, vmid: guestVmid } = await waitForCloneTaskAndEnableAgent(
    provisionResult,
    auth,
    vmid,
    (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    guestResourceOptsFromBlock(q, flags),
  );

  const rootfsGb = resolveRootfsGbFromDeployment({ ...deployment.raw, proxmox: px });
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
    hostname: systemId.replace(/^vm-/, ""),
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

  const sshCfg =
    isObject(deployment.configure) && isObject(deployment.configure.ssh)
      ? deployment.configure.ssh
      : {};
  let sshUser = resolveGuestSshUser(sshCfg.user);
  const sshHost =
    typeof sshCfg.host === "string" && sshCfg.host.trim() ? sshCfg.host.trim() : ip.split("/")[0];

  if (shouldInstall(install)) {
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
  }

  return { ok: true, system_id: systemId, host_id: hostId, vmid: guestVmid, mode: "proxmox-qemu" };
}

/**
 * @param {ReturnType<typeof resolveHdcRunnerDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {ReturnType<typeof createHdcRunnerVaultAccess>} vaultAccess
 * @param {{ ctPasswordCache?: { value: string | null } }} runOpts
 */
async function deployOne(deployment, flags, vaultAccess, runOpts) {
  const inv = deployTargetInventory(root, target, { systemIdOverride: deployment.systemId });
  logDeployInventoryStatus(target, verb, inv);

  errout.write(
    `[hdc] ${target} ${verb}: ${deployment.systemId} mode ${deployment.mode} …\n`,
  );

  if (deployment.mode === "configure-only") {
    return applyHdcRunnerOnDeployment(deployment, {
      root,
      proxmoxRoot,
      flags,
      vaultAccess,
      runInstall: shouldInstall(deployment.install),
      dryRun: false,
    });
  }

  if (deployment.mode === "proxmox-lxc") {
    const prov = await deployLxc(deployment, flags, runOpts);
    if (!prov.ok || prov.skipped) return prov;
  } else if (deployment.mode === "proxmox-qemu") {
    const prov = await deployQemu(deployment, flags);
    if (!prov.ok || prov.skipped) return prov;
  } else {
    return { ok: false, system_id: deployment.systemId, message: `unsupported mode ${deployment.mode}` };
  }

  return applyHdcRunnerOnDeployment(deployment, {
    root,
    proxmoxRoot,
    flags,
    vaultAccess,
    runInstall: shouldInstall(deployment.install),
    dryRun: false,
  });
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: deploy hdc-runner (stderr log; JSON on stdout).\n`);
  const flags = parseArgvFlags(process.argv.slice(2));
  const dryRun = flagGet(flags, "dry-run") !== undefined;

  if (!existsSync(ensurePackageConfig().path)) {
    process.stdout.write(
      JSON.stringify({ ok: false, target, verb, message: "package config missing" }, null, 2) + "\n",
    );
    process.exitCode = 1;
    return;
  }

  const vaultAccess = createHdcRunnerVaultAccess();
  const deployments = resolveHdcRunnerDeployments(readCfg(), flags);
  /** @type {Record<string, unknown>[]} */
  const results = [];
  const ctPasswordCache = { value: null };

  for (const d of deployments) {
    if (dryRun) {
      results.push({ system_id: d.systemId, ok: true, dry_run: true });
      continue;
    }
    try {
      results.push(await deployOne(d, flags, vaultAccess, { ctPasswordCache }));
    } catch (e) {
      results.push({
        ok: false,
        system_id: d.systemId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const ok = results.every((r) => r.ok !== false);
  const payload = { ok, target, verb, deployments: results };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  await runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
  });
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${e instanceof Error ? e.message : e}\n`);
  process.exitCode = 1;
});
