#!/usr/bin/env node
/**
 * Deploy llama-server on Proxmox LXC (multi-instance deployments[]).
 *
 * Usage: hdc run service llama-cpp deploy -- [--instance a | --system-id llama-cpp-a] [--skip-install]
 *        hdc run service llama-cpp deploy -- [--skip-existing | --redeploy-existing]
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
import { createProxmoxHostProvisioner } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { resolveProvisionVmid } from "../../../infrastructure/proxmox/lib/proxmox-vmid-conflict.mjs";

import { resolveLlamaCppDeployments } from "../lib/deployments.mjs";
import { findClusterGuest } from "../../ollama/lib/guest-exists.mjs";
import { installLlamaCppInCt, resolvePveSshForHost } from "../lib/llama-cpp-install.mjs";
import { resolveLxcRootPassword } from "../../ollama/lib/lxc-password.mjs";
import { promptExistingGuestAction } from "../lib/prompt-existing.mjs";
import { waitForLlamaCppProvisionTask } from "../lib/proxmox-task-wait.mjs";

import { runOperationReportTail } from "../../../lib/operation-report.mjs";import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/llama-cpp/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

const root = repoRoot();

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
  return "prompt";
}

/**
 * @param {ReturnType<typeof resolveLlamaCppDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 * @param {{ ctPasswordCache?: { value: string | null } }} [runOpts]
 */
async function deployOne(deployment, flags, log, runOpts = {}) {
  const { mode, systemId, proxmox: px, install, server } = deployment;
  const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

  const inv = deployTargetInventory(root, target, { systemIdOverride: systemId });
  logDeployInventoryStatus(target, verb, inv);

  if (!mode) {
    return { ok: false, system_id: systemId, message: "missing mode" };
  }

  if (mode !== "proxmox-lxc") {
    return {
      ok: false,
      system_id: systemId,
      message: `mode ${mode} not supported — use proxmox-lxc`,
    };
  }

  if (!isObject(px)) {
    return { ok: false, system_id: systemId, message: "bad proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) {
    return { ok: false, system_id: systemId, message: "missing host_id" };
  }

  errout.write(
    `[hdc] ${target} ${verb}: ${JSON.stringify(systemId)} on ${JSON.stringify(hostId)} …\n`,
  );
  errout.write(`[hdc] ${target} ${verb}: authorizing Proxmox API for host ${JSON.stringify(hostId)} …\n`);
  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });

  const lxc = isObject(px.lxc) ? px.lxc : {};
  const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
  if (!Number.isFinite(vmid) || vmid <= 0) {
    return { ok: false, system_id: systemId, host_id: hostId, message: "invalid vmid" };
  }

  const located = await findClusterGuest(
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
    if (action === "skip") {
      errout.write(`[hdc] ${target} ${verb}: skipping ${systemId} (vmid ${vmid} already exists).\n`);
      return {
        ok: true,
        system_id: systemId,
        host_id: hostId,
        mode,
        skipped: true,
        message: "guest already exists",
        guest: { vmid, node: located.node, name: located.name },
      };
    }
    errout.write(
      `[hdc] ${target} ${verb}: ${systemId} vmid ${vmid} exists — redeploy (provision skipped, install only).\n`,
    );
    skipProvision = true;
  }

  /** @type {import("../../../lib/host-provisioner.mjs").ProvisionResult | null} */
  let provisionResult = null;
  /** @type {{ ok: boolean; backend?: string; message?: string } | null} */
  let installResult = null;

  if (!skipProvision) {
    const prov = createProxmoxHostProvisioner({
      apiBase: auth.host.apiBase,
      pveNode: auth.host.pveNode,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
    });
    const hostname =
      (typeof lxc.hostname === "string" && lxc.hostname.trim()) ||
      systemId.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 63) ||
      "llama-cpp";
    const memoryMb = typeof lxc.memory_mb === "number" ? lxc.memory_mb : Number(lxc.memory_mb);
    const cores = typeof lxc.cores === "number" ? lxc.cores : Number(lxc.cores);
    const diskGb = typeof lxc.rootfs_gb === "number" ? lxc.rootfs_gb : Number(lxc.rootfs_gb);
    if (![memoryMb, cores, diskGb].every((n) => Number.isFinite(n) && n > 0)) {
      return { ok: false, system_id: systemId, host_id: hostId, message: "invalid lxc sizing fields" };
    }
    const cache = runOpts.ctPasswordCache ?? { value: null };
    const reusePassword = cache.value !== null;
    let rootPassword;
    try {
      rootPassword = await resolveLxcRootPassword(systemId, vmid, lxc, flags, {
        cached: cache.value,
        setCached: (v) => {
          cache.value = v;
        },
      });
    } catch (e) {
      return {
        ok: false,
        system_id: systemId,
        host_id: hostId,
        message: String(/** @type {Error} */ (e).message || e),
      };
    }
    if (reusePassword) {
      errout.write(`[hdc] ${target} ${verb}: using same LXC root password as prior instance in this run.\n`);
    }
    /** @type {Record<string, unknown>} */
    const parameters = { ...lxc, password: rootPassword };
    provisionResult = await prov.createContainer(log, {
      name: hostname,
      memoryMb,
      cores,
      diskGb,
      parameters,
    });
    if (!provisionResult.ok) {
      return {
        ok: false,
        system_id: systemId,
        host_id: hostId,
        mode,
        result: provisionResult,
      };
    }
    try {
      await waitForLlamaCppProvisionTask(provisionResult, auth, systemId, resolveProvisionVmid(provisionResult, vmid));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      return {
        ok: false,
        system_id: systemId,
        host_id: hostId,
        mode,
        result: provisionResult,
        message: msg,
      };
    }
  } else {
    provisionResult = {
      ok: true,
      message: `LXC ${vmid} already present on ${located.node}`,
      details: { vmid, node: located.node, type: "lxc", skipped_provision: true },
    };
  }

  const guestVmid = resolveProvisionVmid(provisionResult, vmid);

  const serverCfg = isObject(server) ? server : {};
  if (shouldInstall(install)) {
    const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
    installResult = await installLlamaCppInCt(
      pveSsh.user,
      pveSsh.host,
      guestVmid,
      install,
      serverCfg,
    );
  } else {
    installResult = { ok: true, message: "skipped" };
    errout.write(`[hdc] ${target} ${verb}: install skipped for ${systemId}.\n`);
  }

  const ok = provisionResult.ok && (!installResult || installResult.ok);
  return {
    ok,
    system_id: systemId,
    host_id: hostId,
    mode,
    redeploy: skipProvision,
    result: provisionResult,
    install: installResult,
  };
}

async function main() {
  errout.write(
    `[hdc] ${target} ${verb}: llama-server via Proxmox LXC (stderr log; JSON on stdout).\n`,
  );

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
  /** @type {ReturnType<typeof resolveLlamaCppDeployments>} */
  let deployments;
  try {
    deployments = resolveLlamaCppDeployments(cfg, flags);
  } catch (e) {
    errout.write(`[hdc] ${target} ${verb}: ${/** @type {Error} */ (e).message}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (deployments.length > 1) {
    errout.write(`[hdc] ${target} ${verb}: deploying ${deployments.length} instance(s) …\n`);
  }

  const log = provisionLogFromConsole(console);
  /** @type {{ value: string | null }} */
  const ctPasswordCache = { value: null };
  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const deployment of deployments) {
    try {
      results.push(await deployOne(deployment, flags, log, { ctPasswordCache }));
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
