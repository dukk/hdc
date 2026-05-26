#!/usr/bin/env node
/**
 * Query Uptime Kuma instance status.
 *
 * Usage: hdc run service uptime-kuma query -- [--instance a | --system-id uptime-kuma-a]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { resolveUptimeKumaDeployments } from "../lib/deployments.mjs";
import { readCtPrimaryIp, resolvePveSshForHost } from "../lib/uptime-kuma-install.mjs";
import { queryUptimeKumaInCt } from "../lib/uptime-kuma-query.mjs";import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/uptime-kuma/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

const target = basename(dirname(here));
const verb = basename(here);
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
 * @param {string} rootDir
 * @param {string} systemId
 */
function loadManualSystemSidecar(rootDir, systemId) {
  const path = join(rootDir, "inventory", "manual", "systems", `${systemId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} sidecar
 */
function primaryIpFromSystem(sidecar) {
  if (!isObject(sidecar)) return null;
  const access = isObject(sidecar.access) ? sidecar.access : {};
  const nodes = Array.isArray(access.nodes) ? access.nodes : [];
  for (const n of nodes) {
    if (!isObject(n)) continue;
    const ip = typeof n.ip === "string" ? n.ip.trim() : "";
    if (ip) return ip;
  }
  return null;
}

/**
 * @param {ReturnType<typeof resolveUptimeKumaDeployments>[number]} deployment
 */
async function queryOne(deployment) {
  const { systemId, proxmox: px, uptimeKuma } = deployment;
  if (!isObject(px)) {
    return { ok: false, system_id: systemId, message: "bad proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  const lxc = isObject(px.lxc) ? px.lxc : {};
  const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
  if (!hostId || !Number.isFinite(vmid) || vmid <= 0) {
    return { ok: false, system_id: systemId, message: "missing host_id or vmid" };
  }

  errout.write(`[hdc] ${target} ${verb}: ${systemId} on ${hostId} vmid ${vmid} …\n`);
  const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
  const sidecar = loadManualSystemSidecar(root, systemId);
  let ip = primaryIpFromSystem(sidecar);
  if (!ip) {
    ip = readCtPrimaryIp(pveSsh.user, pveSsh.host, vmid);
  }

  const ukCfg = isObject(uptimeKuma) ? uptimeKuma : {};
  const port =
    typeof ukCfg.port === "number" && Number.isFinite(ukCfg.port)
      ? ukCfg.port
      : Number(ukCfg.port) || 3001;

  const status = queryUptimeKumaInCt(pveSsh.user, pveSsh.host, vmid, port);
  return {
    system_id: systemId,
    host_id: hostId,
    vmid,
    ip,
    url: ip ? `http://${ip}:${port}` : null,
    ok: status.ok,
    status,
  };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Uptime Kuma status (stderr log; JSON on stdout).\n`);

  if (!existsSync(ensurePackageConfig().path)) {
    errout.write(`[hdc] ${target} ${verb}: missing packages/services/uptime-kuma/config.json\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  let deployments;
  try {
    deployments = resolveUptimeKumaDeployments(cfg, flags, { skipInstall: true });
  } catch (e) {
    errout.write(`[hdc] ${target} ${verb}: ${/** @type {Error} */ (e).message}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  /** @type {Record<string, unknown>[]} */
  const instances = [];
  for (const deployment of deployments) {
    try {
      instances.push(await queryOne(deployment));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      instances.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  const ok = instances.every((r) => r.ok);
  process.stdout.write(
    `${JSON.stringify(
      { ok, target, verb, generated_at: new Date().toISOString(), count: instances.length, instances },
      null,
      2,
    )}\n`,
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
