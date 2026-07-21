import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

import { formatRepoJson, hdcPrivateRoot, resolveRepoFile } from "./private-repo.mjs";
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
 * @typedef {object} SyncClumpRepoResult
 * @property {boolean} ok
 * @property {string} path
 * @property {string} action
 * @property {string} ref
 * @property {string|null} resolved
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
 * @param {string[]} args
 * @param {{ stdio?: "inherit"|"pipe"; encoding?: BufferEncoding }} [opts]
 */
export function defaultGitRun(args, opts = {}) {
  const stdio = opts.stdio ?? "inherit";
  return spawnSync("git", args, {
    stdio,
    shell: false,
    encoding: opts.encoding ?? (stdio === "pipe" ? "utf8" : undefined),
  });
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
 * True when `ref` names a remote-tracking branch under origin after fetch.
 * @param {string} dest
 * @param {string} ref
 * @param {(args: string[], opts?: { stdio?: "inherit"|"pipe"; encoding?: BufferEncoding }) => import("node:child_process").SpawnSyncReturns<string|Buffer>} git
 */
export function isRemoteBranchRef(dest, ref, git = defaultGitRun) {
  const r = git(["-C", dest, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${ref}`], {
    stdio: "pipe",
    encoding: "utf8",
  });
  return (r.status ?? 1) === 0;
}

/**
 * @param {string} dest
 * @param {(args: string[], opts?: { stdio?: "inherit"|"pipe"; encoding?: BufferEncoding }) => import("node:child_process").SpawnSyncReturns<string|Buffer>} [git]
 * @returns {string|null}
 */
export function readClumpRepoResolved(dest, git = defaultGitRun) {
  if (!existsSync(dest)) return null;
  const r = git(["-C", dest, "rev-parse", "HEAD"], { stdio: "pipe", encoding: "utf8" });
  if ((r.status ?? 1) !== 0) return null;
  const sha = String(r.stdout || "").trim();
  return sha || null;
}

/**
 * Checkout `ref` (branch, tag, or commit) after fetch. Pulls ff-only only for branches.
 * @param {string} dest
 * @param {string} ref
 * @param {(args: string[], opts?: { stdio?: "inherit"|"pipe"; encoding?: BufferEncoding }) => import("node:child_process").SpawnSyncReturns<string|Buffer>} git
 * @returns {{ ok: boolean; action: string }}
 */
export function checkoutClumpRepoRef(dest, ref, git = defaultGitRun) {
  let r = git(["-C", dest, "fetch", "origin", "--tags"], { stdio: "inherit" });
  if ((r.status ?? 1) !== 0) return { ok: false, action: "fetch-failed" };

  // Fetch the named ref when possible (branches/tags). SHAs may fail; ignore and rely on prior fetch.
  r = git(["-C", dest, "fetch", "origin", ref], { stdio: "pipe", encoding: "utf8" });
  if ((r.status ?? 1) !== 0) {
    r = git(["-C", dest, "fetch", "origin"], { stdio: "inherit" });
    if ((r.status ?? 1) !== 0) return { ok: false, action: "fetch-failed" };
  }

  if (isRemoteBranchRef(dest, ref, git)) {
    r = git(["-C", dest, "checkout", "-B", ref, `origin/${ref}`], { stdio: "inherit" });
    if ((r.status ?? 1) !== 0) return { ok: false, action: "checkout-failed" };
    return { ok: true, action: "pulled" };
  }

  r = git(["-C", dest, "checkout", "--detach", ref], { stdio: "inherit" });
  if ((r.status ?? 1) !== 0) {
    // Tags/branches checked out locally without --detach
    r = git(["-C", dest, "checkout", ref], { stdio: "inherit" });
    if ((r.status ?? 1) !== 0) return { ok: false, action: "checkout-failed" };
  }
  return { ok: true, action: "checked-out" };
}

/**
 * @param {ClumpsReposConfig} config
 * @param {ClumpRepoEntry} repo
 * @param {{
 *   log?: (line: string) => void;
 *   dryRun?: boolean;
 *   git?: typeof defaultGitRun;
 * }} [opts]
 * @returns {SyncClumpRepoResult}
 */
export function syncClumpRepo(config, repo, opts = {}) {
  const log = opts.log ?? (() => {});
  const git = opts.git ?? defaultGitRun;
  const cacheDir = config.cache_dir || expandHome("~/.hdc/clump-repos");
  const dest = join(cacheDir, repo.id);
  const ref = String(repo.ref || "main").trim() || "main";

  if (opts.dryRun) {
    log(`would sync ${repo.id} @ ${ref} → ${dest}`);
    return { ok: true, path: dest, action: "dry-run", ref, resolved: null };
  }

  let cloned = false;
  if (!existsSync(dest)) {
    log(`cloning ${repo.url} → ${dest}`);
    const r = git(["clone", repo.url, dest], { stdio: "inherit" });
    if ((r.status ?? 1) !== 0) {
      return { ok: false, path: dest, action: "clone-failed", ref, resolved: null };
    }
    cloned = true;
  }

  log(`syncing ${repo.id} @ ${ref}`);
  const checked = checkoutClumpRepoRef(dest, ref, git);
  if (!checked.ok) {
    return { ok: false, path: dest, action: checked.action, ref, resolved: null };
  }

  const resolved = readClumpRepoResolved(dest, git);
  const action = cloned ? "cloned" : checked.action;
  return { ok: true, path: dest, action, ref, resolved };
}

/**
 * Write lasting `ref` for a repo into hdc-private `.hdc/clumps-repos.json`.
 * @param {string} publicRoot
 * @param {string} repoId
 * @param {string} ref
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ path: string; repoId: string; ref: string }}
 */
export function persistClumpRepoRef(publicRoot, repoId, ref, env = process.env) {
  const id = String(repoId || "").trim();
  const nextRef = String(ref || "").trim();
  if (!id) throw new Error("persistClumpRepoRef: repo id is required");
  if (!nextRef) throw new Error("persistClumpRepoRef: ref is required");

  const privateRoot = hdcPrivateRoot(publicRoot, env);
  if (!privateRoot) {
    throw new Error(
      "hdc-private not configured (set HDC_PRIVATE_ROOT or sibling hdc-private); cannot persist clump ref",
    );
  }

  const privPath = join(privateRoot, CONFIG_REL);
  const loaded = loadClumpsReposConfig(publicRoot, env);
  const known = loaded.repos.find((r) => r.id === id);
  if (!known) {
    throw new Error(`clumps: unknown repo ${JSON.stringify(id)}`);
  }

  /** @type {Record<string, unknown>} */
  let data;
  if (existsSync(privPath)) {
    data = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(privPath, "utf8")));
  } else {
    data = {
      version: 1,
      cache_dir: "~/.hdc/clump-repos",
      repos: loaded.repos.map((r) => ({
        id: r.id,
        url: r.url,
        ref: r.ref,
        mode: r.mode,
      })),
      precedence: loaded.precedence ?? loaded.repos.map((r) => r.id),
      overrides: loaded.overrides ?? {},
    };
  }

  /** @type {Record<string, unknown>[]} */
  const repos = Array.isArray(data.repos)
    ? data.repos.filter((row) => row && typeof row === "object" && !Array.isArray(row)).map((row) => ({
        .../** @type {Record<string, unknown>} */ (row),
      }))
    : [];

  let found = false;
  for (const row of repos) {
    if (String(row.id || "").trim() === id) {
      row.ref = nextRef;
      if (!row.url) row.url = known.url;
      if (!row.mode) row.mode = known.mode;
      found = true;
      break;
    }
  }
  if (!found) {
    repos.push({ id, url: known.url, ref: nextRef, mode: known.mode });
  }
  data.repos = repos;
  if (data.version == null) data.version = 1;

  mkdirSync(dirname(privPath), { recursive: true });
  writeFileSync(privPath, formatRepoJson(data), "utf8");
  return { path: privPath, repoId: id, ref: nextRef };
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

export { CONFIG_REL as CLUMPS_REPOS_CONFIG_REL };
