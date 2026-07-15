import { existsSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "../../paths.mjs";

/**
 * Active clumps tree root (external cache or in-repo `clumps/` during transition).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function clumpsRoot(env = process.env) {
  const explicit = env.HDC_CLUMPS_ROOT?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const legacy = join(repoRoot(), "clumps");
  if (existsSync(legacy)) return legacy;
  const sibling = join(repoRoot(), "..", "hdc-clumps");
  if (existsSync(sibling)) return sibling;
  if (explicit) return explicit;
  return legacy;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function servicesPackagesDir(env = process.env) {
  return join(clumpsRoot(env), "services");
}

/**
 * @param {...string} segments Path under clumps root (e.g. infrastructure/proxmox/lib/foo.mjs)
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function clumpPath(...segments) {
  return join(clumpsRoot(process.env), ...segments);
}
