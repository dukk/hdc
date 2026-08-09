/**
 * Upsert / prune automated inventory sidecars under operations/automated/.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  AUTOMATED_NETWORKS,
  AUTOMATED_POLICIES,
  AUTOMATED_SYSTEMS,
  automatedCategoryRel,
  automatedSidecarRel,
} from "../inventory-paths.mjs";
import { preferredNewFilePath, writeResolvedRepoJson } from "../private-repo.mjs";

/**
 * @typedef {object} AutomatedInventoryLog
 * @property {(s: string) => void} [info]
 * @property {(s: string) => void} [warn]
 */

/**
 * @param {unknown} payload
 * @param {string} [backendId]
 * @returns {boolean}
 */
export function isAutomatedBackendSidecar(payload, backendId = "unifi-network") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const o = /** @type {Record<string, unknown>} */ (payload);
  if (typeof o._automated_source === "string" && o._automated_source === backendId) return true;
  const tags = Array.isArray(o.tags) ? o.tags.map((t) => String(t)) : [];
  if (backendId === "unifi-network") {
    return tags.includes("unifi") && tags.includes("automated");
  }
  return tags.includes("automated") && tags.includes(backendId);
}

/**
 * @param {"systems"|"networks"|"policies"} category
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Absolute directory for new/updated automated sidecars
 */
function automatedCategoryAbsDir(category, publicRoot, env) {
  return preferredNewFilePath(publicRoot, automatedCategoryRel(category), env);
}

/**
 * Write automated inventory sidecars; optionally prune stale UniFi-automated files.
 *
 * @param {string} publicRoot hdc public repo root
 * @param {Record<string, unknown>[]} records
 * @param {{
 *   category: "systems"|"networks"|"policies";
 *   backendId?: string;
 *   prune?: boolean;
 *   env?: NodeJS.ProcessEnv;
 *   log?: AutomatedInventoryLog;
 * }} opts
 * @returns {{ written: number; pruned: number; paths: string[]; pruned_paths: string[] }}
 */
export function writeAutomatedInventorySidecars(publicRoot, records, opts) {
  const category = opts.category;
  const backendId = opts.backendId ?? "unifi-network";
  const prune = opts.prune === true;
  const env = opts.env ?? process.env;
  const log = opts.log;
  /** @type {string[]} */
  const paths = [];
  /** @type {Set<string>} */
  const keepIds = new Set();

  for (const rec of records) {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    if (!id) continue;
    keepIds.add(id);
    const rel = automatedSidecarRel(category, id);
    const absPath = preferredNewFilePath(publicRoot, rel, env);
    mkdirSync(dirname(absPath), { recursive: true });
    writeResolvedRepoJson(
      {
        found: true,
        path: absPath,
        rel,
        source: absPath.includes("hdc-private") ? "private" : "public",
        privateRoot: null,
      },
      rec,
    );
    paths.push(absPath);
    log?.info?.(`wrote automated ${category} ${id} → ${rel}`);
  }

  /** @type {string[]} */
  const prunedPaths = [];
  if (prune) {
    const dir = automatedCategoryAbsDir(category, publicRoot, env);
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json") || name.startsWith("_")) continue;
        const stem = name.slice(0, -".json".length);
        if (keepIds.has(stem)) continue;
        const abs = join(dir, name);
        let payload;
        try {
          payload = JSON.parse(readFileSync(abs, "utf8"));
        } catch {
          continue;
        }
        if (!isAutomatedBackendSidecar(payload, backendId)) continue;
        unlinkSync(abs);
        prunedPaths.push(abs);
        log?.info?.(`pruned automated ${category} ${stem}`);
      }
    }
  }

  return {
    written: paths.length,
    pruned: prunedPaths.length,
    paths,
    pruned_paths: prunedPaths,
  };
}

export { AUTOMATED_NETWORKS, AUTOMATED_POLICIES, AUTOMATED_SYSTEMS };
