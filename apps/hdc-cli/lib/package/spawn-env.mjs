import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isPackagedMode, platformRoot, workspaceRoot } from "../../paths.mjs";
import { clumpsRoot } from "./clumps-root.mjs";

/**
 * Augment spawn env for clump verb scripts (import hooks + path hints).
 * @param {NodeJS.ProcessEnv} runEnv
 * @param {string} cliAppDir Absolute apps/hdc-cli directory
 * @param {string} [clumpsRootOverride] Optional clumps tree root for this run
 * @returns {NodeJS.ProcessEnv}
 */
export function augmentPackageSpawnEnv(runEnv, cliAppDir, clumpsRootOverride) {
  const hookDir = join(cliAppDir, "lib", "package");
  const preload = join(hookDir, "preload.mjs");
  const preloadUrl = pathToFileURL(preload).href;
  const importFlag = `--import=${preloadUrl}`;
  const existing = String(runEnv.NODE_OPTIONS ?? "").trim();
  runEnv.NODE_OPTIONS = existing.includes(importFlag)
    ? existing
    : [existing, importFlag].filter(Boolean).join(" ");
  runEnv.HDC_PACKAGE_LIB_DIR = hookDir;
  runEnv.HDC_CLUMPS_ROOT = clumpsRootOverride || runEnv.HDC_CLUMPS_ROOT || clumpsRoot(runEnv);
  if (!String(runEnv.HDC_ROOT ?? "").trim()) {
    runEnv.HDC_ROOT = platformRoot(runEnv);
  }
  if (!String(runEnv.HDC_PRIVATE_ROOT ?? "").trim()) {
    const ws = workspaceRoot(runEnv);
    if (ws) runEnv.HDC_PRIVATE_ROOT = ws;
  }
  if (!String(runEnv.HDC_PACKAGED ?? "").trim() && isPackagedMode(runEnv)) {
    runEnv.HDC_PACKAGED = "1";
  }
  return runEnv;
}

/**
 * @param {string} cliAppDir
 * @returns {string}
 */
export function packagePreloadImportFlag(cliAppDir) {
  const preload = join(cliAppDir, "lib", "package", "preload.mjs");
  return `--import=${pathToFileURL(preload).href}`;
}
