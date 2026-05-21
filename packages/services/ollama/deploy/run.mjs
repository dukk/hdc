#!/usr/bin/env node
/**
 * Deploy Ollama on Proxmox (LXC or QEMU clone) or as Docker on an Ubuntu SSH host.
 * Uses `HostProvisioner` implementations from infrastructure packages (see `packages/lib/host-provisioner.mjs`).
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout, env } from "node:process";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { createProxmoxHostProvisioner } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { createUbuntuDockerHostProvisioner } from "../../../infrastructure/ubuntu/lib/ubuntu-docker-host-provisioner.mjs";
import { resolveUbuntuBootstrapSsh } from "../../../infrastructure/ubuntu/lib/ubuntu-ssh-resolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const cfgPath = join(here, "..", "config.json");

const inv = deployTargetInventory(root, target);
logDeployInventoryStatus(target, verb, inv);

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

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Ollama install via infrastructure provisioners (stderr log; JSON on stdout).\n`);
  if (!inv.ready) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing — see stderr" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const cfg = readCfg();
  const deploy = isObject(cfg.deploy) ? cfg.deploy : {};
  const mode = typeof deploy.mode === "string" ? deploy.mode.trim() : "";
  if (!mode) {
    errout.write(`[hdc] ${target} ${verb}: set deploy.mode to proxmox-lxc | proxmox-qemu | ubuntu-docker\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "missing deploy.mode" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const log = provisionLogFromConsole(console);
  const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");
  const ubuntuRoot = join(root, "packages", "infrastructure", "ubuntu");

  if (mode === "ubuntu-docker") {
    const ub = cfg.ubuntu;
    if (!isObject(ub)) {
      errout.write(`[hdc] ${target} ${verb}: ubuntu-docker requires config.ubuntu object\n`);
      process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: "bad ubuntu config" }, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    const bid = typeof ub.bootstrap_host_id === "string" ? ub.bootstrap_host_id.trim() : "";
    if (!bid) {
      errout.write(`[hdc] ${target} ${verb}: ubuntu.bootstrap_host_id required\n`);
      process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: "missing bootstrap_host_id" }, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    errout.write(`[hdc] ${target} ${verb}: mode ubuntu-docker — resolving SSH for bootstrap host ${JSON.stringify(bid)} …\n`);
    const ssh = resolveUbuntuBootstrapSsh(ubuntuRoot, bid, env);
    if (!ssh) {
      errout.write(`[hdc] ${target} ${verb}: no SSH target in packages/infrastructure/ubuntu/config.json for ${JSON.stringify(bid)}\n`);
      process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: "ssh not resolved" }, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    const dk = isObject(ub.docker) ? ub.docker : {};
    /** @type {Record<string, unknown>} */
    const parameters = { ...dk };
    const prov = createUbuntuDockerHostProvisioner({ sshUser: ssh.user, sshHost: ssh.host });
    const result = await prov.createContainer(log, {
      name: typeof dk.container_name === "string" && dk.container_name.trim() ? dk.container_name.trim() : "ollama",
      parameters,
    });
    process.stdout.write(
      `${JSON.stringify({ ok: result.ok, target, verb, mode, system_id: inv.systemId, result }, null, 2)}\n`,
    );
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const px = cfg.proxmox;
  if (!isObject(px)) {
    errout.write(`[hdc] ${target} ${verb}: Proxmox modes require config.proxmox\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: "bad proxmox config" }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) {
    errout.write(`[hdc] ${target} ${verb}: proxmox.host_id required\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: "missing host_id" }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  errout.write(`[hdc] ${target} ${verb}: mode ${JSON.stringify(mode)} — authorizing Proxmox API for host ${JSON.stringify(hostId)} …\n`);
  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
  const prov = createProxmoxHostProvisioner({
    apiBase: auth.host.apiBase,
    pveNode: auth.host.pveNode,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
  });

  if (mode === "proxmox-lxc") {
    const lxc = isObject(px.lxc) ? px.lxc : {};
    const hostname =
      (typeof lxc.hostname === "string" && lxc.hostname.trim()) ||
      inv.systemId.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 63) ||
      "ollama";
    const memoryMb = typeof lxc.memory_mb === "number" ? lxc.memory_mb : Number(lxc.memory_mb);
    const cores = typeof lxc.cores === "number" ? lxc.cores : Number(lxc.cores);
    const diskGb = typeof lxc.rootfs_gb === "number" ? lxc.rootfs_gb : Number(lxc.rootfs_gb);
    if (![memoryMb, cores, diskGb].every((n) => Number.isFinite(n) && n > 0)) {
      errout.write(`[hdc] ${target} ${verb}: proxmox.lxc needs numeric memory_mb, cores, rootfs_gb\n`);
      process.stdout.write(
        `${JSON.stringify({ ok: false, target, verb, message: "invalid lxc sizing fields" }, null, 2)}\n`,
      );
      process.exitCode = 1;
      return;
    }
    /** @type {Record<string, unknown>} */
    const parameters = { ...lxc };
    const result = await prov.createContainer(log, {
      name: hostname,
      memoryMb,
      cores,
      diskGb,
      parameters,
    });
    if (result.ok) {
      errout.write(
        `[hdc] ${target} ${verb}: after the CT boots, install Ollama inside it, e.g. pct exec <vmid> -- bash -lc 'curl -fsSL https://ollama.com/install.sh | sh' (adjust vmid from Proxmox or result.details).\n`,
      );
    }
    process.stdout.write(
      `${JSON.stringify({ ok: result.ok, target, verb, mode, system_id: inv.systemId, result }, null, 2)}\n`,
    );
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (mode === "proxmox-qemu") {
    const q = isObject(px.qemu) ? px.qemu : {};
    const name =
      (typeof q.name === "string" && q.name.trim()) ||
      inv.systemId.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 63) ||
      "ollama";
    const newid = typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
    const templateVmid = typeof q.template_vmid === "number" ? q.template_vmid : Number(q.template_vmid);
    if (!Number.isFinite(newid) || newid <= 0 || !Number.isFinite(templateVmid) || templateVmid <= 0) {
      errout.write(`[hdc] ${target} ${verb}: proxmox.qemu needs positive numeric vmid and template_vmid\n`);
      process.stdout.write(
        `${JSON.stringify({ ok: false, target, verb, message: "invalid qemu vmid fields" }, null, 2)}\n`,
      );
      process.exitCode = 1;
      return;
    }
    /** @type {Record<string, unknown>} */
    const parameters = { ...q };
    const result = await prov.createVm(log, {
      name,
      vmid: Number.isFinite(newid) ? newid : undefined,
      templateVmid: Number.isFinite(templateVmid) ? templateVmid : undefined,
      parameters,
    });
    if (result.ok) {
      errout.write(
        `[hdc] ${target} ${verb}: after clone completes, install the guest OS workload (Ollama) over SSH or cloud-init as you prefer.\n`,
      );
    }
    process.stdout.write(
      `${JSON.stringify({ ok: result.ok, target, verb, mode, system_id: inv.systemId, result }, null, 2)}\n`,
    );
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  errout.write(`[hdc] ${target} ${verb}: unknown deploy.mode ${JSON.stringify(mode)}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: "unknown mode" }, null, 2)}\n`,
  );
  process.exitCode = 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
