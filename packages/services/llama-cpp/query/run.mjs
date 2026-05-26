#!/usr/bin/env node
/**
 * Query llama-cpp deployments (config summary + optional live CT status).
 *
 * Usage: hdc run service llama-cpp query -- [--instance a]
 *        hdc run service llama-cpp query -- --live   (pct exec on each deployment)
 */
import { basename, dirname, join, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  listLlamaCppDeploymentSummaries,
  normalizeLlamaCppConfig,
  resolveLlamaCppDeployments,
} from "../lib/deployments.mjs";
import { resolvePveSshForHost } from "../lib/llama-cpp-install.mjs";
import { queryLlamaCppInCt } from "../lib/query-status.mjs";import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/llama-cpp/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;

const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function loadCfg() {
  const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  if (loaded.ok && loaded.data) {
    _pkgConfig = { data: loaded.data, path: loaded.path, source: loaded.source };
  }
  return loaded;
}

async function main() {
  const rel = relative(root, ensurePackageConfig().path).replace(/\\/g, "/");
  const loaded = loadCfg();
  const cfg = loaded.ok && isObject(loaded.data) ? loaded.data : null;
  const flags = parseArgvFlags(process.argv.slice(2));
  const live = flagGet(flags, "live") !== undefined;

  errout.write(`[hdc] ${target} ${verb}: config ${rel} ${loaded.ok ? "loaded" : "not loaded"}.\n`);

  /** @type {unknown[]} */
  let deployments = [];
  /** @type {string | null} */
  let configError = null;
  let schemaVersion = null;

  if (cfg) {
    try {
      const norm = normalizeLlamaCppConfig(cfg);
      schemaVersion = norm.schemaVersion;
      deployments = listLlamaCppDeploymentSummaries(cfg);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
  }

  /** @type {Record<string, unknown>[]} */
  const liveResults = [];

  if (live && cfg && !configError) {
    let selected;
    try {
      selected = resolveLlamaCppDeployments(cfg, flags);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
    if (!configError && selected) {
      errout.write(`[hdc] ${target} ${verb}: live status for ${selected.length} deployment(s) …\n`);
      for (const d of selected) {
        const px = isObject(d.proxmox) ? d.proxmox : null;
        const hostId =
          px && typeof px.host_id === "string" ? px.host_id.trim() : "";
        const lxc = px && isObject(px.lxc) ? px.lxc : {};
        const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
        if (!hostId || !Number.isFinite(vmid)) {
          liveResults.push({
            system_id: d.systemId,
            ok: false,
            message: "missing host_id or vmid",
          });
          continue;
        }
        try {
          const ssh = resolvePveSshForHost(proxmoxRoot, hostId);
          const status = await queryLlamaCppInCt(
            ssh.user,
            ssh.host,
            vmid,
            isObject(d.server) ? d.server : {},
          );
          liveResults.push({ system_id: d.systemId, host_id: hostId, ok: true, ...status });
        } catch (e) {
          liveResults.push({
            system_id: d.systemId,
            host_id: hostId,
            ok: false,
            message: String(/** @type {Error} */ (e).message || e),
          });
        }
      }
    }
  }

  const defaultMode =
    cfg && isObject(cfg.defaults) && typeof cfg.defaults.mode === "string"
      ? cfg.defaults.mode
      : null;

  const payload = {
    target,
    verb: "query",
    ok: Boolean(cfg) && !configError,
    config_path: rel,
    schema_version: schemaVersion,
    deploy_mode: defaultMode,
    deployments,
    live: live ? liveResults : undefined,
    config_error: configError,
    message: configError
      ? `Config error: ${configError}`
      : cfg
        ? `${deployments.length} deployment(s) configured. Deploy: hdc run service llama-cpp deploy — Live status: hdc run service llama-cpp query -- --live`
        : `Copy packages/services/llama-cpp/config.example.json to config.json.`,
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
