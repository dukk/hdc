import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { packagesDir } from "./paths.mjs";

export const VERBS = ["deploy", "maintain", "query", "teardown"];

/** CLI tier tokens for `hdc run <tier> <package> <verb>`. */
export const RUN_TIERS = ["client", "infrastructure", "service"];

/** @type {Record<string, string>} CLI tier → packages/ subdirectory. */
export const RUN_TIER_TO_DIR = {
  client: "clients",
  infrastructure: "infrastructure",
  service: "services",
};

/** @type {Record<string, string>} packages/ subdirectory → CLI tier. */
export const DIR_TO_RUN_TIER = {
  clients: "client",
  infrastructure: "infrastructure",
  services: "service",
};

const PACKAGE_DIRS = ["infrastructure", "services", "clients"];

/**
 * @param {string} packagesDirAbs
 */
export function discoverManifests(packagesDirAbs) {
  /** @type {{ path: string, dir: string, raw: Record<string, unknown> }[]} */
  const out = [];
  if (!existsSync(packagesDirAbs)) return out;
  for (const tier of PACKAGE_DIRS) {
    const tierDir = join(packagesDirAbs, tier);
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
 * Manifest ids for every package under `packages/` (for validation helpers, if any).
 * @param {string} root
 * @returns {Set<string>}
 */
export function packageManifestIds(root) {
  const ids = new Set();
  for (const m of discoverManifests(packagesDir(root))) {
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
 * @returns {string | null} packages/ subdirectory name, or null if invalid.
 */
export function parseRunTier(token) {
  const t = String(token ?? "").trim().toLowerCase();
  return RUN_TIER_TO_DIR[t] ?? null;
}

/**
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 * @returns {string | null} CLI tier token derived from manifest directory path.
 */
export function manifestRunTier(m) {
  const parts = m.dir.replace(/\\/g, "/").split("/");
  const idx = parts.indexOf("packages");
  if (idx < 0 || idx + 1 >= parts.length) return null;
  return DIR_TO_RUN_TIER[parts[idx + 1]] ?? null;
}

/**
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }[]} manifests
 * @param {string} tierToken
 * @param {string} packageId
 */
export function manifestByTierAndId(manifests, tierToken, packageId) {
  const m = manifestById(manifests, packageId);
  if (!m) return null;
  const expected = parseRunTier(tierToken);
  if (!expected) return null;
  const dir = m.dir.replace(/\\/g, "/");
  return dir.includes(`/packages/${expected}/`) ? m : null;
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
 * Platform ids for packages that use `run <tier> <package> <platform> <verb>`.
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
 * @property {string} packageId
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
  const packageId = forward[0] ?? "";
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
    return { packageId, platform, verb };
  }
  if (forward.length !== 2) {
    return { error: "need <package> <verb>" };
  }
  const verb = forward[1];
  if (!VERBS.includes(verb)) {
    return { error: `verb must be one of: ${VERBS.join(", ")}` };
  }
  return { packageId, platform: null, verb };
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
