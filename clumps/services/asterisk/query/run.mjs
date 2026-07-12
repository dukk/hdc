#!/usr/bin/env node
/**
 * Query Asterisk deployments (config summary + optional live status).
 *
 * Usage: hdc run service asterisk query -- [--instance a]
 *        hdc run service asterisk query -- --live
 */
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../apps/hdc-cli/paths.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  listAsteriskDeploymentSummaries,
  normalizeAsteriskConfig,
  resolveAsteriskDeployments,
} from "../lib/deployments.mjs";
import { resolvePveSshForHost } from "../lib/asterisk-install.mjs";
import { resolveConfigureExec } from "../lib/asterisk-configure.mjs";
import { buildQuerySummary, queryAsteriskInCt, queryAsteriskViaExec } from "../lib/query-status.mjs";
import { loadClumpConfigFromClumpRoot, tryLoadClumpConfigFromClumpRoot } from "../../../lib/clump-run-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const clumpRoot = join(here, "..");
const CLUMP_CONFIG_EXAMPLE = "clumps/services/asterisk/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;

function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadClumpConfigFromClumpRoot(clumpRoot, { exampleRel: CLUMP_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const proxmoxRoot = join(root, "clumps", "infrastructure", "proxmox");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function loadCfg() {
  const loaded = tryLoadClumpConfigFromClumpRoot(clumpRoot, { exampleRel: CLUMP_CONFIG_EXAMPLE });
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
      const norm = normalizeAsteriskConfig(cfg);
      schemaVersion = norm.schemaVersion;
      deployments = listAsteriskDeploymentSummaries(cfg);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
  }

  /** @type {Record<string, unknown>[]} */
  const liveResults = [];

  if (live && cfg && !configError) {
    let selected;
    try {
      selected = resolveAsteriskDeployments(cfg, flags);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
    if (selected) {
      for (const d of selected) {
        try {
          if (d.mode === "proxmox-lxc" && isObject(d.proxmox)) {
            const hostId = String(d.proxmox.host_id);
            const vmid = Number(isObject(d.proxmox.lxc) ? d.proxmox.lxc.vmid : 0);
            const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
            const liveStatus = await queryAsteriskInCt(pveSsh.user, pveSsh.host, vmid);
            liveResults.push({
              system_id: d.systemId,
              ...buildQuerySummary(d.asterisk, null),
              live: liveStatus,
            });
          } else {
            const exec = resolveConfigureExec(d, proxmoxRoot);
            const liveStatus = await queryAsteriskViaExec(exec);
            liveResults.push({
              system_id: d.systemId,
              ...buildQuerySummary(d.asterisk, null),
              live: liveStatus,
            });
          }
        } catch (e) {
          liveResults.push({
            system_id: d.systemId,
            ok: false,
            message: String(/** @type {Error} */ (e).message || e),
          });
        }
      }
    }
  }

  const payload = {
    ok: !configError,
    target,
    verb,
    config_path: rel,
    config_loaded: loaded.ok,
    schema_version: schemaVersion,
    config_error: configError,
    deployments,
    live_requested: live,
    live_results: liveResults.length ? liveResults : undefined,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = configError ? 1 : 0;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
