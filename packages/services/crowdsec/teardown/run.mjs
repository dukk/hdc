#!/usr/bin/env node
/**
 * Teardown CrowdSec Proxmox LXC deployments.
 *
 * Usage: hdc run service crowdsec teardown -- [--instance a | --system-id crowdsec-a]
 *        hdc run service crowdsec teardown -- [--dry-run] [--yes]
 */
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { stopAndDestroyLxc } from "../../../infrastructure/proxmox/lib/proxmox-guest-destroy.mjs";
import { resolveCrowdsecDeployments } from "../lib/deployments.mjs";
import { findClusterGuest } from "../lib/guest-exists.mjs";
import { confirmTeardown, teardownDryRun } from "../../ollama/lib/teardown-confirm.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/crowdsec/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let pkgConfig = null;
function ensurePackageConfig() {
  if (!pkgConfig) {
    pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return pkgConfig;
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
 * @param {ReturnType<typeof resolveCrowdsecDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 */
async function teardownOne(deployment, flags) {
  const { mode, systemId, proxmox: px } = deployment;
  const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");
  const dryRun = teardownDryRun(flags);
  if (mode !== "proxmox-lxc") return { ok: false, system_id: systemId, message: `unsupported mode ${mode}` };
  if (!isObject(px)) return { ok: false, system_id: systemId, message: "bad proxmox config" };
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  const lxc = isObject(px.lxc) ? px.lxc : {};
  const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
  if (!hostId || !Number.isFinite(vmid) || vmid <= 0) {
    return { ok: false, system_id: systemId, host_id: hostId, message: "invalid host_id or vmid" };
  }

  errout.write(
    `[hdc] ${target} ${verb}: locating ${JSON.stringify(systemId)} vmid ${vmid} (host ${JSON.stringify(hostId)}) ...\n`,
  );
  errout.write(`[hdc] ${target} ${verb}: authorizing Proxmox API for host ${JSON.stringify(hostId)} ...\n`);
  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
  const located = await findClusterGuest(
    auth.host.apiBase,
    auth.authorization,
    auth.rejectUnauthorized,
    vmid,
  );
  if (!located) {
    return { ok: true, system_id: systemId, host_id: hostId, mode, skipped: true, message: "guest not found", vmid };
  }
  const detail = `vmid ${vmid} on ${located.node}${located.name ? ` (${located.name})` : ""}`;
  if (dryRun) {
    return {
      ok: true,
      system_id: systemId,
      host_id: hostId,
      mode,
      dry_run: true,
      vmid,
      node: located.node,
      message: "dry-run",
    };
  }
  const proceed = await confirmTeardown(systemId, detail, flags);
  if (!proceed) {
    return { ok: true, system_id: systemId, host_id: hostId, mode, skipped: true, message: "cancelled", vmid };
  }
  try {
    await stopAndDestroyLxc({
      apiBase: auth.host.apiBase,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
      node: located.node,
      vmid,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${systemId}: ${line}\n`),
    });
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    return { ok: false, system_id: systemId, host_id: hostId, mode, vmid, node: located.node, message: msg };
  }
  return {
    ok: true,
    system_id: systemId,
    host_id: hostId,
    mode,
    destroyed: true,
    vmid,
    node: located.node,
    message: `lxc ${vmid} destroyed`,
  };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: tear down CrowdSec LXC (stderr log; JSON on stdout).\n`);
  if (!existsSync(ensurePackageConfig().path)) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing - see stderr" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  let deployments;
  try {
    deployments = resolveCrowdsecDeployments(cfg, flags);
  } catch (e) {
    const message = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${message}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const results = [];
  for (const deployment of deployments) {
    try {
      results.push(await teardownOne(deployment, flags));
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
