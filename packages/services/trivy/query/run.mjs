#!/usr/bin/env node
/**
 * Query Trivy deployment status.
 *
 * Usage: hdc run service trivy query -- [--instance a | --system-id trivy-a]
 *        hdc run service trivy query -- --live
 */
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { listTrivyDeploymentSummaries, normalizeTrivyConfig, resolveTrivyDeployments } from "../lib/deployments.mjs";
import { readCtPrimaryIp, readTrivyVersionInCt, resolvePveSshForHost, trivyInstalled } from "../lib/trivy-install.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/trivy/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let pkgConfig = null;

const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function ensurePackageConfig() {
  if (!pkgConfig) pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  return pkgConfig;
}
function loadCfg() {
  const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  if (loaded.ok && loaded.data) pkgConfig = { data: loaded.data, path: loaded.path, source: loaded.source };
  return loaded;
}

async function main() {
  const loaded = loadCfg();
  const rel = relative(root, loaded.ok ? loaded.path : ensurePackageConfig().path).replace(/\\/g, "/");
  const cfg = loaded.ok && isObject(loaded.data) ? loaded.data : null;
  const flags = parseArgvFlags(process.argv.slice(2));
  const live = flagGet(flags, "live") !== undefined;
  errout.write(`[hdc] ${target} ${verb}: config ${rel} ${loaded.ok ? "loaded" : "not loaded"}.\n`);

  let deployments = [];
  /** @type {string | null} */
  let configError = null;
  let schemaVersion = null;
  if (cfg) {
    try {
      const norm = normalizeTrivyConfig(cfg);
      schemaVersion = norm.schemaVersion;
      deployments = listTrivyDeploymentSummaries(cfg);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
  }

  /** @type {Record<string, unknown>[]} */
  const liveResults = [];
  if (live && cfg && !configError) {
    let selected;
    try {
      selected = resolveTrivyDeployments(cfg, flags);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
    if (selected) {
      for (const d of selected) {
        const px = isObject(d.proxmox) ? d.proxmox : {};
        const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
        const lxc = isObject(px.lxc) ? px.lxc : {};
        const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
        if (!hostId || !Number.isFinite(vmid)) {
          liveResults.push({ system_id: d.systemId, ok: false, message: "missing host_id or vmid" });
          continue;
        }
        try {
          const ssh = resolvePveSshForHost(proxmoxRoot, hostId);
          const ip = readCtPrimaryIp(ssh.user, ssh.host, vmid);
          const installed = trivyInstalled(ssh.user, ssh.host, vmid);
          const version = readTrivyVersionInCt(ssh.user, ssh.host, vmid);
          liveResults.push({ ok: true, system_id: d.systemId, host_id: hostId, vmid, ip, installed, version });
        } catch (e) {
          liveResults.push({ system_id: d.systemId, ok: false, message: String(/** @type {Error} */ (e).message || e) });
        }
      }
    }
  }

  const payload = {
    ok: !configError && (loaded.ok || loaded.missing),
    target,
    verb,
    config_path: rel,
    config_loaded: loaded.ok,
    config_missing: loaded.missing === true,
    config_error: configError,
    schema_version: schemaVersion,
    deployments,
    live,
    live_results: live ? liveResults : undefined,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = payload.ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
