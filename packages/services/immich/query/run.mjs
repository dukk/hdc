#!/usr/bin/env node
/**
 * Query Immich deployments (config summary + optional live VM status).
 *
 * Usage: hdc run service immich query -- [--instance a]
 *        hdc run service immich query -- --live
 */
import { basename, dirname, join, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { createConfigureExec } from "../../postfix-relay/lib/postfix-relay-configure.mjs";
import {
  listImmichDeploymentSummaries,
  normalizeImmichConfig,
  resolveImmichDeployments,
} from "../lib/deployments.mjs";
import { queryImmichOnHost } from "../lib/query-status.mjs";import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/immich/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;

const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();

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
      const norm = normalizeImmichConfig(cfg);
      schemaVersion = norm.schemaVersion;
      deployments = listImmichDeploymentSummaries(cfg);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
  }

  /** @type {Record<string, unknown>[]} */
  const liveResults = [];

  if (live && cfg && !configError) {
    let selected;
    try {
      selected = resolveImmichDeployments(cfg, flags);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
    if (selected) {
      for (const d of selected) {
        const configure = isObject(d.configure) ? d.configure : {};
        const ssh = isObject(configure.ssh) ? configure.ssh : {};
        const user = typeof ssh.user === "string" ? ssh.user.trim() : "root";
        const host = typeof ssh.host === "string" ? ssh.host.trim() : "";
        if (!host) {
          liveResults.push({
            system_id: d.systemId,
            ok: false,
            message: "missing configure.ssh.host",
          });
          continue;
        }
        errout.write(`[hdc] ${target} ${verb}: live query ${d.systemId} at ${user}@${host} …\n`);
        try {
          const exec = createConfigureExec("ssh", { user, host });
          const status = await queryImmichOnHost(exec, d.immich, d.install);
          liveResults.push({
            system_id: d.systemId,
            ok: status.http_ok !== false && status.docker_active === "active",
            ...status,
          });
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
    ok: !configError && (loaded.ok || loaded.missing),
    target,
    verb,
    config_path: rel,
    config_loaded: loaded.ok,
    config_missing: Boolean(loaded.missing),
    config_parse_error: loaded.error ?? null,
    config_error: configError,
    schema_version: schemaVersion,
    deployments,
    live_requested: live,
    live: liveResults.length ? liveResults : undefined,
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
