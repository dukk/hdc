#!/usr/bin/env node
/**
 * Deploy Ollama on Proxmox (LXC or QEMU clone) or as Docker on an Ubuntu SSH host.
 * Multi-instance: deployments[] in config.json. With no selector, deploys all entries.
 *
 * Usage: hdc run ollama deploy -- [--instance a | --system-id ct-ollama-a] [--skip-install]
 *        hdc run ollama deploy -- [--skip-existing | --redeploy-existing]
 *        LXC root password: prompted on create (masked), or proxmox.lxc.password / --password
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout, env } from "node:process";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { createProxmoxHostProvisioner } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { createUbuntuDockerHostProvisioner } from "../../../infrastructure/ubuntu/lib/ubuntu-docker-host-provisioner.mjs";
import { resolveUbuntuBootstrapSsh } from "../../../infrastructure/ubuntu/lib/ubuntu-ssh-resolve.mjs";
import { resolveOllamaDeployments } from "../lib/deployments.mjs";
import { findClusterGuest } from "../lib/guest-exists.mjs";
import { installOllamaInCt, resolvePveSshForHost } from "../lib/ollama-install.mjs";
import { resolveLxcRootPassword } from "../lib/lxc-password.mjs";
import { promptExistingGuestAction } from "../lib/prompt-existing.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const cfgPath = join(here, "..", "config.json");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readCfg() {
  if (!existsSync(cfgPath)) {
    throw new Error(`Missing ${cfgPath} — copy packages/services/ollama/config.example.json`);
  }
  return JSON.parse(readFileSync(cfgPath, "utf8"));
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
 * @param {ReturnType<typeof resolveOllamaDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 * @param {{ ctPasswordCache?: { value: string | null } }} [runOpts]
 */
async function deployOne(deployment, flags, log, runOpts = {}) {
  const { mode, systemId, proxmox: px, ubuntu: ub, install } = deployment;
  const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");
  const ubuntuRoot = join(root, "packages", "infrastructure", "ubuntu");

  const inv = deployTargetInventory(root, target, { systemIdOverride: systemId });
  logDeployInventoryStatus(target, verb, inv);

  if (!mode) {
    return { ok: false, system_id: systemId, message: "missing mode" };
  }

  if (mode === "ubuntu-docker") {
    if (!isObject(ub)) {
      return { ok: false, system_id: systemId, message: "bad ubuntu config" };
    }
    const bid = typeof ub.bootstrap_host_id === "string" ? ub.bootstrap_host_id.trim() : "";
    if (!bid) {
      return { ok: false, system_id: systemId, message: "missing bootstrap_host_id" };
    }
    errout.write(`[hdc] ${target} ${verb}: ${systemId} ubuntu-docker on ${JSON.stringify(bid)} …\n`);
    const ssh = resolveUbuntuBootstrapSsh(ubuntuRoot, bid, env);
    if (!ssh) {
      return { ok: false, system_id: systemId, message: "ssh not resolved" };
    }
    const dk = isObject(ub.docker) ? ub.docker : {};
    const prov = createUbuntuDockerHostProvisioner({ sshUser: ssh.user, sshHost: ssh.host });
    const result = await prov.createContainer(log, {
      name: typeof dk.container_name === "string" && dk.container_name.trim() ? dk.container_name.trim() : "ollama",
      parameters: { ...dk },
    });
    return { ok: result.ok, system_id: systemId, mode, result };
  }

  if (!isObject(px)) {
    return { ok: false, system_id: systemId, message: "bad proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) {
    return { ok: false, system_id: systemId, message: "missing host_id" };
  }

  errout.write(
    `[hdc] ${target} ${verb}: ${JSON.stringify(systemId)} on ${JSON.stringify(hostId)} mode ${JSON.stringify(mode)} …\n`,
  );
  errout.write(`[hdc] ${target} ${verb}: authorizing Proxmox API for host ${JSON.stringify(hostId)} …\n`);
  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });

  if (mode === "proxmox-lxc") {
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
    /** @type {{ ok: boolean; method?: string; message?: string } | null} */
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
        "ollama";
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
        return { ok: false, system_id: systemId, host_id: hostId, message: String(/** @type {Error} */ (e).message || e) };
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
    } else {
      provisionResult = {
        ok: true,
        message: `LXC ${vmid} already present on ${located.node}`,
        details: { vmid, node: located.node, type: "lxc", skipped_provision: true },
      };
    }

    if (shouldInstall(install)) {
      const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
      installResult = await installOllamaInCt(pveSsh.user, pveSsh.host, vmid, install);
    } else {
      installResult = { ok: true, method: "skipped", message: "skipped" };
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

  if (mode === "proxmox-qemu") {
    const prov = createProxmoxHostProvisioner({
      apiBase: auth.host.apiBase,
      pveNode: auth.host.pveNode,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
    });
    const q = isObject(px.qemu) ? px.qemu : {};
    const name =
      (typeof q.name === "string" && q.name.trim()) ||
      systemId.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 63) ||
      "ollama";
    const newid = typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
    const templateVmid = typeof q.template_vmid === "number" ? q.template_vmid : Number(q.template_vmid);
    if (!Number.isFinite(newid) || newid <= 0 || !Number.isFinite(templateVmid) || templateVmid <= 0) {
      return { ok: false, system_id: systemId, host_id: hostId, message: "invalid qemu vmid fields" };
    }
    const provisionResult = await prov.createVm(log, {
      name,
      vmid: newid,
      templateVmid,
      parameters: { ...q },
    });
    return {
      ok: provisionResult.ok,
      system_id: systemId,
      host_id: hostId,
      mode,
      result: provisionResult,
    };
  }

  return { ok: false, system_id: systemId, message: `unknown mode ${mode}` };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Ollama via infrastructure provisioners (stderr log; JSON on stdout).\n`);

  if (!existsSync(cfgPath)) {
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
  /** @type {ReturnType<typeof resolveOllamaDeployments>} */
  let deployments;
  try {
    deployments = resolveOllamaDeployments(cfg, flags);
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
  process.stdout.write(
    `${JSON.stringify({ ok, target, verb, count: results.length, results }, null, 2)}\n`,
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
