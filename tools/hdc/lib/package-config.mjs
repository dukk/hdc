import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot } from "../paths.mjs";
import {
  assertJsonObject,
  formatResolvedRepoFileLabel,
  missingRepoFileError,
  readResolvedRepoJson,
  resolveRepoFile,
} from "./private-repo.mjs";

/**
 * @param {string} packageRoot Absolute package directory (e.g. packages/services/bind)
 * @param {string} [filename]
 * @param {string} [publicRoot]
 */
export function packageConfigRel(packageRoot, filename = "config.json", publicRoot = repoRoot()) {
  const rel = relative(publicRoot, join(packageRoot, filename)).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) {
    throw new Error(`packageRoot must be under repo root: ${packageRoot}`);
  }
  return rel;
}

/**
 * @param {string} packageRoot
 * @param {string} [filename]
 * @param {string} [publicRoot]
 */
export function resolvePackageConfig(publicRoot, packageRoot, filename = "config.json", env = process.env) {
  const rel = packageConfigRel(packageRoot, filename, publicRoot);
  return resolveRepoFile(publicRoot, rel, env);
}

/**
 * @param {string} packageRoot
 * @param {{ filename?: string; publicRoot?: string; exampleRel?: string; log?: (line: string) => void; env?: NodeJS.ProcessEnv }} [opts]
 */
export function loadPackageConfigFromPackageRoot(packageRoot, opts = {}) {
  const publicRoot = opts.publicRoot ?? repoRoot();
  const filename = opts.filename ?? "config.json";
  const resolved = resolvePackageConfig(publicRoot, packageRoot, filename, opts.env);
  if (!resolved.found) {
    const rel = resolved.rel;
    const exampleRel =
      opts.exampleRel ??
      rel.replace(/\/config\.json$/, "/config.example.json").replace(/^config\.json$/, "config.example.json");
    throw missingRepoFileError(resolved, { exampleRel });
  }
  const data = assertJsonObject(readResolvedRepoJson(resolved));
  if (opts.log) {
    opts.log(
      `[hdc] config ${formatResolvedRepoFileLabel(resolved, publicRoot)} loaded (${resolved.source}).\n`,
    );
  }
  return { path: resolved.path, rel: resolved.rel, source: resolved.source, data, resolved };
}

/**
 * @param {string} packageRoot
 * @param {{ filename?: string; publicRoot?: string; env?: NodeJS.ProcessEnv }} [opts]
 */
export function tryLoadPackageConfigFromPackageRoot(packageRoot, opts = {}) {
  const publicRoot = opts.publicRoot ?? repoRoot();
  const filename = opts.filename ?? "config.json";
  const resolved = resolvePackageConfig(publicRoot, packageRoot, filename, opts.env);
  if (!resolved.found) {
    return {
      ok: false,
      missing: true,
      path: resolved.path,
      rel: resolved.rel,
      source: resolved.source,
      resolved,
    };
  }
  try {
    const data = assertJsonObject(readResolvedRepoJson(resolved));
    return {
      ok: true,
      missing: false,
      path: resolved.path,
      rel: resolved.rel,
      source: resolved.source,
      data,
      resolved,
    };
  } catch (e) {
    return {
      ok: false,
      missing: false,
      path: resolved.path,
      rel: resolved.rel,
      source: resolved.source,
      error: /** @type {Error} */ (e).message,
      resolved,
    };
  }
}

/**
 * Package root from a verb script directory (deploy/maintain/query/run.mjs).
 * @param {string} scriptDir dirname of run.mjs
 */
export function packageRootFromScriptDir(scriptDir) {
  return join(scriptDir, "..");
}

/**
 * Package root from import.meta.url of run.mjs.
 * @param {string} metaUrl
 */
export function packageRootFromMeta(metaUrl) {
  return packageRootFromScriptDir(dirname(fileURLToPath(metaUrl)));
}
