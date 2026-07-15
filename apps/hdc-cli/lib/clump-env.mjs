import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { applyDotenvFile, parseDotenvText } from "../env.mjs";
import { GLOBAL_ENV_KEYS } from "./env-example-split.mjs";
import { ENV_KEY_TO_PACKAGE_ID } from "./env-key-clumps.mjs";
import { tryLoadClumpConfigFromClumpRoot } from "./clump-config.mjs";
import { hdcPrivateRoot } from "./private-repo.mjs";
import { manifestId } from "../manifests.mjs";
import { resolveSecretBackendMode } from "./secret-backend.mjs";
import { getProcessBwSession } from "./vaultwarden-cli.mjs";

export { GLOBAL_ENV_KEYS } from "./env-example-split.mjs";

const ROOT_DOTENV_REL = ".env";
const PACKAGE_DOTENV_NAME = ".env";
const PROXMOX_PACKAGE_ID = "proxmox";

/** @type {Set<string>} */
const warnedRootFallbackKeys = new Set();

/** Modes that require Proxmox API credentials from clumps/infrastructure/proxmox/.env */
const PROXMOX_MODES = new Set([
  "proxmox-lxc",
  "proxmox-qemu",
  "proxmox-qemu-clone",
  "proxmox-qemu-iso",
]);

/**
 * @param {string} key
 */
export function isGlobalEnvKey(key) {
  return GLOBAL_ENV_KEYS.has(key);
}

/**
 * @param {string} key
 * @returns {string | null} Package manifest id
 */
export function clumpIdForEnvKey(key) {
  if (isGlobalEnvKey(key)) return null;
  if (ENV_KEY_TO_PACKAGE_ID[key]) return ENV_KEY_TO_PACKAGE_ID[key];
  if (key.startsWith("HDC_PROXMOX_")) return PROXMOX_PACKAGE_ID;
  if (key.startsWith("HDC_USER_HDC_PASSWORD_")) return null;
  return null;
}

/**
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} [env]
 */
function privateRootFor(publicRoot, env = process.env) {
  return hdcPrivateRoot(publicRoot, env);
}

/**
 * Load public hdc and hdc-private `.env` at `relPath` into `targetEnv` (private overrides public).
 * @param {string} publicRoot
 * @param {string} relPath
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} targetEnv
 * @param {{ existsSync?: typeof existsSync; join?: typeof join }} [deps]
 * @returns {{ loaded: string[] }}
 */
export function loadMergedRepoDotenv(publicRoot, relPath, targetEnv, deps = {}) {
  const joinFn = deps.join ?? join;
  const exists = deps.existsSync ?? existsSync;
  const rel = relPath.replace(/\\/g, "/");
  const publicPath = joinFn(publicRoot, rel);
  const privateRoot = privateRootFor(publicRoot, targetEnv);
  /** @type {string[]} */
  const loaded = [];

  if (exists(publicPath)) {
    applyDotenvFile(publicPath, targetEnv, false);
    loaded.push(publicPath);
  }
  if (privateRoot) {
    const privatePath = joinFn(privateRoot, rel);
    if (exists(privatePath)) {
      applyDotenvFile(privatePath, targetEnv, false);
      loaded.push(privatePath);
    }
  }
  return { loaded };
}

/**
 * Load platform `.env`, then workspace (hdc-private) `.env` with override so operator
 * settings win. Re-resolves private root after platform load (may set HDC_PRIVATE_ROOT).
 * @param {{
 *   env: NodeJS.ProcessEnv | Record<string, string | undefined>;
 *   loadDotenv?: (path: string, override?: boolean) => void;
 *   join: typeof join;
 *   existsSync?: typeof existsSync;
 * }} deps
 * @param {string} root Platform / public root
 */
export function bootstrapGlobalEnv(deps, root) {
  const joinFn = deps.join;
  const exists = deps.existsSync ?? existsSync;
  const targetEnv = deps.env;
  const publicPath = joinFn(root, ROOT_DOTENV_REL);
  if (exists(publicPath)) {
    applyDotenvFile(publicPath, targetEnv, false);
  }
  const privateRoot = hdcPrivateRoot(root, /** @type {NodeJS.ProcessEnv} */ (targetEnv));
  if (privateRoot) {
    const privatePath = joinFn(privateRoot, ROOT_DOTENV_REL);
    if (exists(privatePath)) {
      applyDotenvFile(privatePath, targetEnv, true);
    }
  }
  return root;
}

/**
 * @param {unknown} mode
 */
function modeUsesProxmox(mode) {
  const m = typeof mode === "string" ? mode.trim() : "";
  if (!m) return false;
  if (PROXMOX_MODES.has(m)) return true;
  return m.startsWith("proxmox-");
}

/**
 * @param {unknown} cfg
 */
export function configUsesProxmox(cfg) {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return false;
  const o = /** @type {Record<string, unknown>} */ (cfg);
  const defaults = o.defaults;
  if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) {
    const d = /** @type {Record<string, unknown>} */ (defaults);
    if (modeUsesProxmox(d.mode)) return true;
  }
  const deployments = o.deployments;
  if (!Array.isArray(deployments)) return false;
  for (const row of deployments) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (modeUsesProxmox(/** @type {Record<string, unknown>} */ (row).mode)) return true;
  }
  return false;
}

/**
 * @param {{ path: string; dir: string; raw: Record<string, unknown> }} manifest
 * @returns {string[]}
 */
export function envIncludesFromManifest(manifest) {
  const v = manifest.raw.env_includes;
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * Resolve clump ids whose `.env` should load before the target clump.
 * @param {{ path: string; dir: string; raw: Record<string, unknown> }} manifest
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveEnvIncludes(manifest, publicRoot, env = process.env) {
  const targetId = manifestId(manifest);
  /** @type {string[]} */
  const includes = [];
  const seen = new Set([targetId]);

  for (const id of envIncludesFromManifest(manifest)) {
    if (!seen.has(id)) {
      includes.push(id);
      seen.add(id);
    }
  }

  if (targetId !== PROXMOX_PACKAGE_ID) {
    try {
      const cfg = tryLoadClumpConfigFromClumpRoot(manifest.dir, { publicRoot, env });
      if (cfg.ok && configUsesProxmox(cfg.data)) {
        if (!seen.has(PROXMOX_PACKAGE_ID)) {
          includes.unshift(PROXMOX_PACKAGE_ID);
          seen.add(PROXMOX_PACKAGE_ID);
        }
      }
    } catch {
      /* optional config */
    }
  }

  return includes;
}

/**
 * @param {string} publicRoot
 * @param {string} clumpId
 * @param {{ clumpsDir: (root: string) => string; join: typeof join }} deps
 * @returns {string | null} Repo-relative path to package .env
 */
export function packageDotenvRel(publicRoot, clumpId, deps) {
  const packagesRoot = deps.clumpsDir(publicRoot);
  for (const tier of ["infrastructure", "services", "clients"]) {
    const rel = join("clumps", tier, clumpId, PACKAGE_DOTENV_NAME).replace(/\\/g, "/");
    const abs = deps.join(packagesRoot, "..", "clumps", tier, clumpId, PACKAGE_DOTENV_NAME);
    const absFromRoot = deps.join(publicRoot, "clumps", tier, clumpId, PACKAGE_DOTENV_NAME);
    if (existsSync(absFromRoot)) return rel;
    if (existsSync(abs)) return rel;
    const privateRoot = privateRootFor(publicRoot, process.env);
    if (privateRoot && existsSync(deps.join(privateRoot, rel))) return rel;
  }
  for (const tier of ["infrastructure", "services", "clients"]) {
    const candidate = join("clumps", tier, clumpId, PACKAGE_DOTENV_NAME).replace(/\\/g, "/");
    if (existsSync(deps.join(publicRoot, "clumps", tier, clumpId))) return candidate;
  }
  return join("clumps", "services", clumpId, PACKAGE_DOTENV_NAME).replace(/\\/g, "/");
}

/**
 * @param {string} publicRoot
 * @param {string} clumpId
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} targetEnv
 * @param {{ clumpsDir: (root: string) => string; join: typeof join; existsSync?: typeof existsSync }} deps
 */
export function loadPackageDotenvById(publicRoot, clumpId, targetEnv, deps) {
  const packagesRoot = deps.clumpsDir(publicRoot);
  const pubPackages = deps.join(packagesRoot, "..");
  for (const tier of ["infrastructure", "services", "clients"]) {
    const rel = join("clumps", tier, clumpId, PACKAGE_DOTENV_NAME).replace(/\\/g, "/");
    const dir = deps.join(publicRoot, "clumps", tier, clumpId);
    if (existsSync(dir)) {
      loadMergedRepoDotenv(publicRoot, rel, targetEnv, deps);
      return rel;
    }
  }
  return null;
}

/**
 * Apply migration fallback: package keys still in root `.env` with one-time warning per key.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} targetEnv
 * @param {{ warn?: (...args: unknown[]) => void; join: typeof join; existsSync?: typeof existsSync }} deps
 * @param {string} publicRoot
 * @param {string} targetPackageId
 */
function applyRootEnvFallback(targetEnv, deps, publicRoot, targetPackageId) {
  const rootPath = deps.join(publicRoot, ROOT_DOTENV_REL);
  const exists = deps.existsSync ?? existsSync;
  if (!exists(rootPath)) return;

  const warn = deps.warn ?? (() => {});
  for (const { key, value } of parseDotenvText(readFileSync(rootPath, "utf8"))) {
    if (isGlobalEnvKey(key)) continue;
    const owner = clumpIdForEnvKey(key);
    if (owner !== targetPackageId && owner !== null) continue;
    if (targetEnv[key] !== undefined) continue;
    targetEnv[key] = value;
    if (!warnedRootFallbackKeys.has(key)) {
      warnedRootFallbackKeys.add(key);
      const dest = owner
        ? `clumps/.../${owner}/.env`
        : `clumps/.../${targetPackageId}/.env`;
      warn(
        `warning: ${key} loaded from root .env (deprecated); move to ${dest} in hdc-private`,
      );
    }
  }
}

/** @internal Test helper */
export function clearRootEnvFallbackWarnings() {
  warnedRootFallbackKeys.clear();
}

/**
 * Build scoped environment for spawning a package script.
 * @param {{ env: NodeJS.ProcessEnv; clumpsDir: (root: string) => string; join: typeof join; warn?: (...args: unknown[]) => void; existsSync?: typeof existsSync }} deps
 * @param {string} publicRoot
 * @param {{ path: string; dir: string; raw: Record<string, unknown> }} manifest
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {NodeJS.ProcessEnv}
 */
export function buildClumpRunEnv(deps, publicRoot, manifest, baseEnv) {
  const source = baseEnv ?? deps.env;
  /** @type {NodeJS.ProcessEnv} */
  const runEnv = { ...source };
  const targetId = manifestId(manifest);

  for (const includeId of resolveEnvIncludes(manifest, publicRoot, runEnv)) {
    loadPackageDotenvById(publicRoot, includeId, runEnv, deps);
  }

  const pkgRel = relative(publicRoot, join(manifest.dir, PACKAGE_DOTENV_NAME)).replace(/\\/g, "/");
  loadMergedRepoDotenv(publicRoot, pkgRel, runEnv, deps);

  applyRootEnvFallback(runEnv, deps, publicRoot, targetId);

  if (resolveSecretBackendMode(runEnv) === "vaultwarden") {
    const bwSession = getProcessBwSession();
    if (bwSession) {
      runEnv.BW_SESSION = bwSession;
    }
  }

  return runEnv;
}

/**
 * Collect HDC_* keys that would be visible for a package run (for `hdc env --run`).
 * @param {{ env: NodeJS.ProcessEnv; clumpsDir: (root: string) => string; join: typeof join; existsSync?: typeof existsSync; warn?: (...args: unknown[]) => void }} deps
 * @param {string} publicRoot
 * @param {{ path: string; dir: string; raw: Record<string, unknown> }} manifest
 */
export function collectPackageRunEnvKeys(deps, publicRoot, manifest) {
  const runEnv = buildClumpRunEnv(deps, publicRoot, manifest);
  return Object.keys(runEnv)
    .filter((k) => k.startsWith("HDC_"))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function collectGlobalEnvKeys(env) {
  return Object.keys(env)
    .filter((k) => k.startsWith("HDC_") && isGlobalEnvKey(k))
    .sort((a, b) => a.localeCompare(b));
}
