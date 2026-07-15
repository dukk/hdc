import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { clumpsRoot } from "./clumps-root.mjs";

const hookDir = dirname(fileURLToPath(import.meta.url));
const packageLibDir = hookDir;
const cliAppDir = join(hookDir, "..", "..");

/**
 * @param {string} specifier
 * @param {import('node:module').ImportMetaResolveContext} context
 * @param {import('node:module').ResolveHook} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("hdc/package/")) {
    const rel = specifier.slice("hdc/package/".length);
    const target = join(packageLibDir, rel);
    if (existsSync(target)) {
      return nextResolve(pathToFileURL(target).href, context);
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
