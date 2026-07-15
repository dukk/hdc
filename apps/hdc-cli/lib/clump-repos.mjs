import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { hdcPrivateRoot, resolveRepoFile } from "./private-repo.mjs";
import { discoverManifests, manifestId } from "../manifests.mjs";

const CONFIG_REL = ".hdc/clumps-repos.json";

/**
 * @typedef {object} ClumpRepoEntry
 * @property {string} id
 * @property {string} url
 * @property {string} ref
 * @property {"active"|"reference"} mode
 */

/**
 * @typedef {object} ClumpsReposConfig
 * @property {number} version
 * @property {string} [cache_dir]
 * @property {ClumpRepoEntry[]} repos
 * @property {string[]} [precedence]
 * @property {Record<string, { repo: string }>} [overrides]
 */

/**
 * @param {string} p
 */
function expandHome(p) {
  const s = String(p || "").trim();
  if (s.startsWith("~/")) return join(homedir(), s.slice(2));
  if (s === "~") return homedir();
  return s;
}

/**
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ClumpsReposConfig}
 */
export function loadClumpsReposConfig(publicRoot, env = process.env) {
  /** @type {Record<string, unknown>} */
  let merged = {
    version: 1,
    cache_dir: "~/.hdc/clump-repos",
    repos: [
      {
        id: "hdc-clumps",
        url: "https://github.com/dukk/hdc-clumps.git",
        ref: "main",
        mode: "active",
      },
    ],
    precedence: ["hdc-clumps"],
    overrides: {},
  };
  const pub = resolveRepoFile(publicRoot, CONFIG_REL, env);
  if (pub.found) {
    merged = { ...merged, ...JSON.parse(readFileSync(pub.path, "utf8")) };
  }
  const privateRoot = hdcPrivateRoot(publicRoot, env);
  if (privateRoot) {
    const privPath = join(privateRoot, CONFIG_REL);
    if (existsSync(privPath)) {
      merged = { ...merged, ...JSON.parse(readFileSync(privPath, "utf8")) };
    }
  }
  /** @type {ClumpRepoEntry[]} */
  const repos = [];
  for (const row of /** @type {unknown[]} */ (merged.repos)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = /** @type {Record<string, unknown>} */ (row);
    const id = String(o.id || "").trim();
    const url = String(o.url || "").trim();
    const ref = String(o.ref || "main").trim() || "main";
    const mode = o.mode === "reference" ? "reference" : "active";
    if (!id || !url) continue;
    const envUrl = env[`HDC_CLUMPS_REPO_${id.toUpperCase().replace(/-/g, "_")}_URL`];
    const envRef = env[`HDC_CLUMPS_REPO_${id.toUpperCase().replace(/-/g, "_")}_REF`];
    repos.push({
      id,
      url: envUrl ? String(envUrl) : url,
      ref: envRef ? String(envRef) : ref,
      mode,
    });
  }
  return {
    version: 1,
    cache_dir: expandHome(String(merged.cache_dir || env.HDC_CLUMPS_CACHE || "~/.hdc/clump-repos")),
    repos,
    precedence: Array.isArray(merged.precedence) ? merged.precedence.map(String) : repos.map((r) => r.id),
    overrides:
      merged.overrides && typeof merged.overrides === "object" && !Array.isArray(merged.overrides)
        ? /** @type {Record<string, { repo: string }>} */ (merged.overrides)
        : {},
  };
}

/**
 * @param {ClumpsReposConfig} config
 * @param {ClumpRepoEntry} repo
 * @param {{ log?: (line: string) => void; dryRun?: boolean }} [opts]
 */
export function syncClumpRepo(config, repo, opts = {}) {
  const log = opts.log ?? (() => {});
  const cacheDir = config.cache_dir || expandHome("~/.hdc/clump-repos");
  const dest = join(cacheDir, repo.id);
  if (opts.dryRun) {
    log(`would sync ${repo.id} → ${dest}`);
    return { ok: true, path: dest, action: "dry-run" };
  }
  if (!existsSync(dest)) {
    log(`cloning ${repo.url} → ${dest}`);
    const r = spawnSync("git", ["clone", "--branch", repo.ref, repo.url, dest], {
      stdio: "inherit",
      shell: false,
    });
    if ((r.status ?? 1) !== 0) return { ok: false, path: dest, action: "clone-failed" };
    return { ok: true, path: dest, action: "cloned" };
  }
  log(`pulling ${repo.id} @ ${repo.ref}`);
  let r = spawnSync("git", ["-C", dest, "fetch", "origin", repo.ref], { stdio: "inherit", shell: false });
  if ((r.status ?? 1) !== 0) return { ok: false, path: dest, action: "fetch-failed" };
  r = spawnSync("git", ["-C", dest, "checkout", repo.ref], { stdio: "inherit", shell: false });
  if ((r.status ?? 1) !== 0) return { ok: false, path: dest, action: "checkout-failed" };
  r = spawnSync("git", ["-C", dest, "pull", "--ff-only", "origin", repo.ref], {
    stdio: "inherit",
    shell: false,
  });
  if ((r.status ?? 1) !== 0) return { ok: false, path: dest, action: "pull-failed" };
  return { ok: true, path: dest, action: "pulled" };
}

/**
 * @param {ClumpsReposConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ repoId: string, root: string, mode: "active"|"reference" }[]}
 */
export function resolveClumpRoots(config, env = process.env) {
  const cacheDir = config.cache_dir || expandHome("~/.hdc/clump-repos");
  const legacy = join(env.HDC_REPO_ROOT || "", "clumps");
  /** @type {{ repoId: string, root: string, mode: "active"|"reference" }[]} */
  const out = [];
  if (env.HDC_CLUMPS_ROOT && existsSync(env.HDC_CLUMPS_ROOT)) {
    out.push({ repoId: "env", root: env.HDC_CLUMPS_ROOT, mode: "active" });
    return out;
  }
  for (const repo of config.repos) {
    const root = join(cacheDir, repo.id);
    if (existsSync(root)) out.push({ repoId: repo.id, root, mode: repo.mode });
  }
  if (!out.length && existsSync(legacy)) {
    out.push({ repoId: "in-tree", root: legacy, mode: "active" });
  }
  return out;
}

/**
 * Discover manifests across active clump repo roots with precedence + overrides.
 * @param {ClumpsReposConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 */
export function discoverAllManifests(config, env = process.env) {
  const roots = resolveClumpRoots(config, env).filter((r) => r.mode === "active");
  const precedence = config.precedence?.length ? config.precedence : roots.map((r) => r.repoId);
  const ordered = [...roots].sort((a, b) => {
    const ai = precedence.indexOf(a.repoId);
    const bi = precedence.indexOf(b.repoId);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });

  /** @type {Map<string, { path: string, dir: string, raw: Record<string, unknown>, repoId: string }>} */
  const byId = new Map();
  for (const root of ordered) {
    for (const m of discoverManifests(root.root)) {
      const id = manifestId(m);
      const override = config.overrides?.[id];
      if (override?.repo && override.repo !== root.repoId) continue;
      if (!byId.has(id)) {
        byId.set(id, { ...m, repoId: root.repoId });
      }
    }
  }
  return [...byId.values()];
}

/**
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} [env]
 */
export function defaultClumpsCacheDir(publicRoot, env = process.env) {
  return loadClumpsReposConfig(publicRoot, env).cache_dir;
}
