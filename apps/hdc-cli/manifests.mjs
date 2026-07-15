import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { clumpsDir as legacyClumpsDir } from "./paths.mjs";
import { discoverAllManifests, loadClumpsReposConfig, resolveClumpRoots } from "./lib/clump-repos.mjs";

export const VERBS = ["deploy", "maintain", "query", "health", "teardown"];

/** CLI tier tokens for `hdc run <tier> <clump> <verb>`. */
export const RUN_TIERS = ["client", "infrastructure", "service"];

/** @type {Record<string, string>} CLI tier → clumps/ subdirectory. */
export const RUN_TIER_TO_DIR = {
  client: "clients",
  infrastructure: "infrastructure",
  infra: "infrastructure",
  service: "services",
};

/** @type {Record<string, string>} clumps/ subdirectory → CLI tier. */
export const DIR_TO_RUN_TIER = {
  clients: "client",
  infrastructure: "infrastructure",
  services: "service",
};

const PACKAGE_DIRS = ["infrastructure", "services", "clients"];

/**
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} [env]
 */
export function discoverAllClumpManifests(publicRoot, env = process.env) {
  const config = loadClumpsReposConfig(publicRoot, env);
  const fromRepos = discoverAllManifests(config, env);
  if (fromRepos.length) return fromRepos;
  return discoverManifests(legacyClumpsDir(publicRoot));
}

/**
 * Primary clumps tree for env resolution (first active repo root or in-tree).
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} [env]
 */
export function primaryClumpsRoot(publicRoot, env = process.env) {
  const config = loadClumpsReposConfig(publicRoot, env);
  const roots = resolveClumpRoots(config, { ...env, HDC_REPO_ROOT: publicRoot }).filter(
    (r) => r.mode === "active",
  );
  if (roots.length) return roots[0].root;
  return legacyClumpsDir(publicRoot);
}

/**
 * @param {string} dirPath
 */
function tierDirFromPath(dirPath) {
  const parts = dirPath.replace(/\\/g, "/").split("/");
  for (const tier of PACKAGE_DIRS) {
    if (parts.includes(tier)) return tier;
  }
  return null;
}

/**
 * @param {string} clumpsDirAbs
 */
export function discoverManifests(clumpsDirAbs) {
  /** @type {{ path: string, dir: string, raw: Record<string, unknown> }[]} */
  const out = [];
  if (!existsSync(clumpsDirAbs)) return out;
  for (const tier of PACKAGE_DIRS) {
    const tierDir = join(clumpsDirAbs, tier);
    if (!existsSync(tierDir)) continue;
    for (const name of readdirSync(tierDir).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))) {
      const dir = join(tierDir, name);
      const mf = join(dir, "manifest.json");
      if (!existsSync(mf)) continue;
      let raw;
      try {
        raw = JSON.parse(readFileSync(mf, "utf8"));
      } catch {
        continue;
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      out.push({ path: mf, dir, raw });
    }
  }
  return out;
}

/**
 * Manifest ids for every clump under `clumps/` (for validation helpers, if any).
 * @param {string} root
 * @returns {Set<string>}
 */
export function clumpManifestIds(root, env = process.env) {
  const ids = new Set();
  for (const m of discoverAllClumpManifests(root, env)) {
    ids.add(manifestId(m));
  }
  return ids;
}

/**
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }[]} manifests
 * @param {string} id
 */
export function manifestById(manifests, id) {
  return manifests.find((m) => manifestId(m) === id) ?? null;
}

/**
 * @param {string} token CLI tier token (client | infrastructure | service).
 * @returns {string | null} clumps/ subdirectory name, or null if invalid.
 */
export function parseRunTier(token) {
  const t = String(token ?? "").trim().toLowerCase();
  return RUN_TIER_TO_DIR[t] ?? null;
}

/**
 * Canonical CLI tier token (e.g. `infra` → `infrastructure`).
 * @param {string} token
 * @returns {string | null}
 */
export function canonicalRunTier(token) {
  const dir = parseRunTier(token);
  return dir ? (DIR_TO_RUN_TIER[dir] ?? null) : null;
}

/** Human-readable tier list for help and error messages. */
export function runTiersUsage() {
  return "client, infrastructure (infra), service";
}

/**
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 * @returns {string | null} CLI tier token derived from manifest directory path.
 */
export function manifestRunTier(m) {
  const tier = tierDirFromPath(m.dir);
  return tier ? (DIR_TO_RUN_TIER[tier] ?? null) : null;
}

/**
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }[]} manifests
 * @param {string} tierToken
 * @param {string} clumpId
 */
export function manifestByTierAndId(manifests, tierToken, clumpId) {
  const m = manifestById(manifests, clumpId);
  if (!m) return null;
  const expected = parseRunTier(tierToken);
  if (!expected) return null;
  const tier = tierDirFromPath(m.dir);
  return tier === expected ? m : null;
}

/** @param {{ path: string, dir: string, raw: Record<string, unknown> }} m */
export function manifestId(m) {
  const id = m.raw.id;
  return typeof id === "string" && id.trim() ? id.trim() : basenameDir(m.dir);
}

/** @param {{ path: string, dir: string, raw: Record<string, unknown> }} m */
export function manifestTitle(m) {
  const t = m.raw.title;
  return typeof t === "string" && t.trim() ? t.trim() : manifestId(m);
}

/** @param {{ path: string, dir: string, raw: Record<string, unknown> }} m */
export function envRequired(m) {
  const v = m.raw.env_required;
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

/** @param {{ path: string, dir: string, raw: Record<string, unknown> }} m */
export function inventoryDocs(m) {
  const v = m.raw.inventory_docs;
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

/**
 * @typedef {object} ManifestService
 * @property {string} id
 * @property {string} title
 * @property {string} verb
 * @property {string} [invoke]
 * @property {string} [summary]
 */

/**
 * Capabilities declared in manifest `services` (infrastructure packages use this heavily).
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 * @returns {ManifestService[]}
 */
export function manifestServices(m) {
  const v = m.raw.services;
  if (!Array.isArray(v)) return [];
  /** @type {ManifestService[]} */
  const out = [];
  for (const row of v) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = /** @type {Record<string, unknown>} */ (row);
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const verb = typeof o.verb === "string" ? o.verb.trim() : "";
    if (!id || !title || !VERBS.includes(verb)) continue;
    if (!verbSpec(m, verb)) continue;
    const invoke = typeof o.invoke === "string" && o.invoke.trim() ? o.invoke.trim() : undefined;
    const summary = typeof o.summary === "string" && o.summary.trim() ? o.summary.trim() : undefined;
    out.push({ id, title, verb, invoke, summary });
  }
  return out;
}

/**
 * @param {ManifestService} svc
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 */
export function formatManifestServiceInvoke(svc, m) {
  const tier = manifestRunTier(m) ?? "infrastructure";
  const pkg = manifestId(m);
  const base = `run ${tier} ${pkg} ${svc.verb}`;
  return svc.invoke ? `${base} -- ${svc.invoke}` : base;
}

/**
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 * @param {string} verb
 */
export function verbSpec(m, verb) {
  const verbs = m.raw.verbs;
  if (!verbs || typeof verbs !== "object" || Array.isArray(verbs)) return null;
  const spec = verbs[verb];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  const script = spec.script;
  if (typeof script !== "string" || !script.trim()) return null;
  return { script: script.trim() };
}

function basenameDir(dir) {
  const parts = dir.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || dir;
}

/**
 * Platform ids for packages that use `run <tier> <clump> <platform> <verb>`.
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 * @returns {string[]}
 */
export function manifestPlatforms(m) {
  const v = m.raw.platforms;
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @typedef {object} RunInvocation
 * @property {string} clumpId
 * @property {string | null} platform
 * @property {string} verb
 */

/**
 * Parse forward argv for `hdc run` (before `--`).
 * @param {string[]} forward
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 * @returns {RunInvocation | { error: string }}
 */
export function resolveRunInvocation(forward, m) {
  const clumpId = forward[0] ?? "";
  const platforms = manifestPlatforms(m);
  if (platforms.length > 0) {
    if (forward.length < 3) {
      return {
        error: `need <platform> <verb> (platforms: ${platforms.join(", ")})`,
      };
    }
    if (forward.length > 3) {
      return { error: "too many arguments before --" };
    }
    const platform = forward[1].trim().toLowerCase();
    const verb = forward[2];
    if (!platforms.includes(platform)) {
      return {
        error: `unknown platform ${JSON.stringify(forward[1])} (expected: ${platforms.join(", ")})`,
      };
    }
    if (!VERBS.includes(verb)) {
      return { error: `verb must be one of: ${VERBS.join(", ")}` };
    }
    return { clumpId, platform, verb };
  }
  if (forward.length !== 2) {
    return { error: "need <clump> <verb>" };
  }
  const verb = forward[1];
  if (!VERBS.includes(verb)) {
    return { error: `verb must be one of: ${VERBS.join(", ")}` };
  }
  return { clumpId, platform: null, verb };
}

/**
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 * @param {string | null} platform
 * @param {string} verb
 */
export function runScriptDir(m, platform, verb) {
  if (platform) {
    return join(m.dir, platform, verb);
  }
  return join(m.dir, verb);
}
