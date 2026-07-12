#!/usr/bin/env node
/**
 * Teardown hdc-runner Proxmox guest (LXC or QEMU).
 *
 * Usage: hdc run service hdc-runner teardown -- [--instance a] [--dry-run] [--yes]
 */
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../apps/hdc-cli/paths.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { stopAndDestroyLxc } from "../../../infrastructure/proxmox/lib/proxmox-guest-destroy.mjs";
import { stopAndDestroyQemu } from "../../step-ca/lib/proxmox-qemu-redeploy.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadClumpConfigFromClumpRoot } from "../../../lib/clump-run-config.mjs";
import { resolveHdcRunnerDeployments } from "../lib/deployments.mjs";
import { findClusterGuest } from "../lib/guest-exists.mjs";
import { confirmTeardown, teardownDryRun } from "../../ollama/lib/teardown-confirm.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const clumpRoot = join(here, "..");
const CLUMP_CONFIG_EXAMPLE = "clumps/services/hdc-runner/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadClumpConfigFromClumpRoot(clumpRoot, { exampleRel: CLUMP_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

const root = repoRoot();
const proxmoxRoot = join(root, "clumps", "infrastructure", "proxmox");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readCfg() {
  return ensurePackageConfig().data;
}

/**
 * @param {ReturnType<typeof resolveHdcRunnerDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 */
async function teardownOne(deployment, flags) {
  const { mode, systemId, proxmox: px } = deployment;
  const dryRun = teardownDryRun(flags);

  if (mode === "configure-only") {
    return { ok: true, system_id: systemId, skipped: true, message: "configure-only" };
  }
  if (!isObject(px)) {
    return { ok: false, system_id: systemId, message: "bad proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) return { ok: false, system_id: systemId, message: "missing host_id" };

  const lxc = isObject(px.lxc) ? px.lxc : {};
  const qemu = isObject(px.qemu) ? px.qemu : {};
  const vmid =
    mode === "proxmox-qemu"
      ? typeof qemu.vmid === "number"
        ? qemu.vmid
        : Number(qemu.vmid)
      : typeof lxc.vmid === "number"
        ? lxc.vmid
        : Number(lxc.vmid);

  if (!Number.isFinite(vmid) || vmid <= 0) {
    return { ok: false, system_id: systemId, message: "invalid vmid" };
  }

  const auth = await authorizeProxmoxForHost({ clumpRoot: proxmoxRoot, hostId });
  const located = await findClusterGuest(
    auth.host.apiBase,
    auth.authorization,
    auth.rejectUnauthorized,
    vmid,
  );
  if (!located) {
    return { ok: true, system_id: systemId, skipped: true, message: "guest not found" };
  }

  if (dryRun) {
    return { ok: true, system_id: systemId, dry_run: true, vmid, node: located.node };
  }

  const confirmed = await confirmTeardown(systemId, vmid, flags);
  if (!confirmed) {
    return { ok: false, system_id: systemId, message: "teardown not confirmed" };
  }

  if (mode === "proxmox-qemu") {
    await stopAndDestroyQemu({
      apiBase: auth.host.apiBase,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
      node: located.node,
      vmid,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });
  } else {
    await stopAndDestroyLxc({
      apiBase: auth.host.apiBase,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
      node: located.node,
      vmid,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });
  }

  return { ok: true, system_id: systemId, destroyed: true, vmid };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: destroy hdc-runner guest.\n`);
  const flags = parseArgvFlags(process.argv.slice(2));

  if (!existsSync(ensurePackageConfig().path)) {
    process.stdout.write(
      JSON.stringify({ ok: false, target, verb, message: "clump config missing" }, null, 2) + "\n",
    );
    process.exitCode = 1;
    return;
  }

  const deployments = resolveHdcRunnerDeployments(readCfg(), flags);
  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const d of deployments) {
    try {
      results.push(await teardownOne(d, flags));
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
    clumpRoot,
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
