import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { clumpsRoot } from "./clumps-root.mjs";

const hookDir = dirname(fileURLToPath(import.meta.url));
const packageLibDir = hookDir;
const cliAppDir = join(hookDir, "..", "..");

/**
 * Resolve `hdc/package/<rel>` from a clump's `lib/` when the importer lives under
 * `{clients|infrastructure|services}/<id>/…` (package scripts keep using hdc/package/*
 * for both shared runtime and clump-local helpers).
 *
 * @param {string} rel
 * @param {string | undefined} parentURL
 * @returns {string | null}
 */
function resolveClumpPackageLib(rel, parentURL) {
  if (!parentURL || typeof parentURL !== "string" || !parentURL.startsWith("file:")) {
    return null;
  }
  let dir;
  try {
    dir = dirname(fileURLToPath(parentURL));
  } catch {
    return null;
  }
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "lib", rel);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Sync resolve for `module.registerHooks()` (and legacy `module.register()`).
 * @param {string} specifier
 * @param {import('node:module').ResolveHookContext} context
 * @param {(specifier: string, context?: import('node:module').ResolveHookContext) => import('node:module').ResolveFnOutput} nextResolve
 * @returns {import('node:module').ResolveFnOutput}
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("hdc/package/")) {
    const rel = specifier.slice("hdc/package/".length);
    const target = join(packageLibDir, rel);
    if (existsSync(target)) {
      return nextResolve(pathToFileURL(target).href, context);
    }
    const fromClump = resolveClumpPackageLib(rel, context.parentURL);
    if (fromClump) {
      return nextResolve(pathToFileURL(fromClump).href, context);
    }
  }
  if (specifier.startsWith("hdc/cli/")) {
    const rel = specifier.slice("hdc/cli/".length);
    const target = join(cliAppDir, rel);
    if (existsSync(target)) {
      return nextResolve(pathToFileURL(target).href, context);
    }
  }
  if (specifier.startsWith("hdc/clump/")) {
    const rel = specifier.slice("hdc/clump/".length);
    const target = join(clumpsRoot(), rel);
    if (existsSync(target)) {
      return nextResolve(pathToFileURL(target).href, context);
    }
  }
  return nextResolve(specifier, context);
}
