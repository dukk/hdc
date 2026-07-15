import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadClumpsReposConfig } from "./lib/clump-repos.mjs";
import { hdcPrivateRoot } from "./lib/private-repo.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * True when hdc-cli is installed as a package (not the git monorepo `apps/hdc-cli` layout).
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isPackagedMode(env = process.env) {
  const flag = String(env.HDC_PACKAGED ?? "")
    .trim()
    .toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  const gitRoot = join(__dirname, "..", "..");
  return !existsSync(join(gitRoot, "apps", "hdc-cli", "paths.mjs"));
}

/**
 * Platform root for public file resolution (schemas examples, clumps-repos defaults).
 * Git checkout: hdc repo root. Packaged: `share/` when present, else package root.
 * Override with `HDC_ROOT`.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function platformRoot(env = process.env) {
  const fromEnv =
    typeof env.HDC_ROOT === "string" && env.HDC_ROOT.trim() ? env.HDC_ROOT.trim() : "";
  if (fromEnv) {
    const abs = resolve(fromEnv);
    if (existsSync(abs)) return abs;
  }
  if (isPackagedMode(env)) {
    const share = join(__dirname, "share");
    return existsSync(share) ? share : __dirname;
  }
  return join(__dirname, "..", "..");
}

/**
 * Compat alias for {@link platformRoot} (clumps / resolveRepoFile public root).
 * @param {NodeJS.ProcessEnv} [env]
 */
export function repoRoot(env = process.env) {
  return platformRoot(env);
}

/**
 * Operator workspace (hdc-private data): `HDC_PRIVATE_ROOT`, sibling `../hdc-private`,
 * or cwd when it looks like an operator repo.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function workspaceRoot(env = process.env, cwd = process.cwd()) {
  return hdcPrivateRoot(platformRoot(env), env, cwd);
}

/**
 * HDC CLI app directory (package root when packaged; `apps/hdc-cli` in git).
 * @param {string} [root] Platform root (unused in packaged mode)
 * @param {NodeJS.ProcessEnv} [env]
 */
export function cliAppDir(root = platformRoot(), env = process.env) {
  if (isPackagedMode(env)) {
    return __dirname;
  }
  const underApps = join(root, "apps", "hdc-cli");
  if (existsSync(join(underApps, "paths.mjs"))) return underApps;
  if (existsSync(join(root, "paths.mjs"))) return root;
  const parentPkg = join(root, "..");
  if (existsSync(join(parentPkg, "paths.mjs"))) return parentPkg;
  return underApps;
}

/** Shared package runtime under hdc-cli (former clumps/lib). */
export function packageLibDir(root = platformRoot(), env = process.env) {
  return join(cliAppDir(root, env), "lib", "package");
}

/** HDC clumps under `clumps/{infrastructure,services,clients}/` (legacy in-tree path). */
export function clumpsDir(root = platformRoot()) {
  return join(root, "clumps");
}

/** Default external clump cache directory. */
export function defaultClumpsCacheDir(root = platformRoot(), env = process.env) {
  return loadClumpsReposConfig(root, env).cache_dir;
}

export function manuallyDeployedDir(root = platformRoot()) {
  return join(root, "docs", "manually-deployed");
}
