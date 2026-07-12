import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { repoRoot } from "../paths.mjs";
import { readResolvedPackageConfigJson } from "./json-config-preprocess.mjs";
import {
  assertJsonObject,
  formatResolvedRepoFileLabel,
  missingRepoFileError,
  preferredNewFilePath,
  resolveRepoFile,
} from "./private-repo.mjs";

/**
 * @typedef {'created'|'overwritten'|'skipped'|'would_create'|'would_overwrite'|'missing_example'} BootstrapPackageConfigAction
 */

/**
 * Copy config.example.json → config.json when missing (never overwrite unless force).
 * @param {string} publicRoot
 * @param {string} configRel repo-relative config.json path
 * @param {string} exampleRel repo-relative config.example.json path
 * @param {{ env?: NodeJS.ProcessEnv; force?: boolean; dryRun?: boolean; privateRoot?: string | null; log?: (line: string) => void }} [opts]
 * @returns {{ action: BootstrapPackageConfigAction; rel: string; path?: string; exampleRel?: string }}
 */
export function bootstrapPackageConfigFromExample(publicRoot, configRel, exampleRel, opts = {}) {
  const env = opts.env ?? process.env;
  const force = Boolean(opts.force);
  const dryRun = Boolean(opts.dryRun);
  const logFn = opts.log;
  const rel = configRel.replace(/\\/g, "/");
  const example = exampleRel.replace(/\\/g, "/");

  /** @type {string} */
  let destPath;
  let destExists = false;

  if (opts.privateRoot) {
    destPath = join(resolve(opts.privateRoot), rel);
    destExists = existsSync(destPath);
  } else {
    const existing = resolveRepoFile(publicRoot, rel, env);
    destExists = existing.found;
    destPath =
      existing.found && force ? existing.path : preferredNewFilePath(publicRoot, rel, env);
  }

  if (destExists && !force) {
    if (logFn) logFn(`skip  ${rel}`);
    return { action: "skipped", rel, path: destPath };
  }

  const exampleResolved = resolveRepoFile(publicRoot, example, env);
  if (!exampleResolved.found) {
    return { action: "missing_example", rel, exampleRel: example };
  }

  if (dryRun) {
    const action = destExists ? "would_overwrite" : "would_create";
    if (logFn) logFn(`${destExists ? "would overwrite" : "would create"}  ${rel}`);
    return { action, rel, path: destPath };
  }

  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(exampleResolved.path, destPath);

  const action = destExists ? "overwritten" : "created";
  if (logFn) logFn(`${destExists ? "overwrite" : "create"}  ${rel}`);
  return { action, rel, path: destPath };
}

/**
 * @param {string} publicRoot
 * @param {string} packageRoot
 * @param {string} filename
 * @param {{ env?: NodeJS.ProcessEnv; exampleRel?: string; bootstrapFromExample?: boolean; log?: (line: string) => void }} opts
 */
function maybeBootstrapPackageConfig(publicRoot, packageRoot, filename, opts) {
  if (opts.bootstrapFromExample !== true) return;
  const resolved = resolvePackageConfig(publicRoot, packageRoot, filename, opts.env);
  if (resolved.found) return;
  const rel = resolved.rel;
  const exampleRel =
    opts.exampleRel ??
    rel.replace(/\/config\.json$/, "/config.example.json").replace(/^config\.json$/, "config.example.json");
  bootstrapPackageConfigFromExample(publicRoot, rel, exampleRel, {
    env: opts.env,
    log: opts.log
      ? (line) => opts.log(`[hdc] bootstrap ${line}\n`)
      : undefined,
  });
}

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
 * @param {{ filename?: string; publicRoot?: string; exampleRel?: string; bootstrapFromExample?: boolean; log?: (line: string) => void; env?: NodeJS.ProcessEnv; preprocess?: boolean }} [opts]
 */
export function loadPackageConfigFromPackageRoot(packageRoot, opts = {}) {
  const publicRoot = opts.publicRoot ?? repoRoot();
  const filename = opts.filename ?? "config.json";
  maybeBootstrapPackageConfig(publicRoot, packageRoot, filename, opts);
  const resolved = resolvePackageConfig(publicRoot, packageRoot, filename, opts.env);
  if (!resolved.found) {
    const rel = resolved.rel;
    const exampleRel =
      opts.exampleRel ??
      rel.replace(/\/config\.json$/, "/config.example.json").replace(/^config\.json$/, "config.example.json");
    throw missingRepoFileError(resolved, { exampleRel });
  }
  const data = assertJsonObject(
    readResolvedPackageConfigJson(resolved, {
      publicRoot,
      env: opts.env,
      preprocess: opts.preprocess,
    }),
  );
  if (opts.log) {
    opts.log(
      `[hdc] config ${formatResolvedRepoFileLabel(resolved, publicRoot)} loaded (${resolved.source}).\n`,
    );
  }
  return { path: resolved.path, rel: resolved.rel, source: resolved.source, data, resolved };
}

/**
 * @param {string} packageRoot
 * @param {{ filename?: string; publicRoot?: string; exampleRel?: string; bootstrapFromExample?: boolean; log?: (line: string) => void; env?: NodeJS.ProcessEnv; preprocess?: boolean }} [opts]
 */
export function tryLoadPackageConfigFromPackageRoot(packageRoot, opts = {}) {
  const publicRoot = opts.publicRoot ?? repoRoot();
  const filename = opts.filename ?? "config.json";
  maybeBootstrapPackageConfig(publicRoot, packageRoot, filename, opts);
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
    const data = assertJsonObject(
      readResolvedPackageConfigJson(resolved, {
        publicRoot,
        env: opts.env,
        preprocess: opts.preprocess,
      }),
    );
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
 * Load config.json when present; otherwise fall back to config.example.json (public repo / CI).
 * @param {string} packageRoot
 * @param {{ filename?: string; publicRoot?: string; exampleRel?: string; bootstrapFromExample?: boolean; log?: (line: string) => void; env?: NodeJS.ProcessEnv; preprocess?: boolean }} [opts]
 */
export function tryLoadPackageConfigOrExample(packageRoot, opts = {}) {
  const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, opts);
  if (loaded?.ok && loaded.data) return loaded;

  const publicRoot = opts.publicRoot ?? repoRoot();
  const exampleRel =
    opts.exampleRel ??
    packageConfigRel(packageRoot, opts.filename ?? "config.json", publicRoot).replace(
      /\/config\.json$/,
      "/config.example.json",
    );
  const exampleResolved = resolveRepoFile(publicRoot, exampleRel, opts.env);
  if (!exampleResolved.found) {
    return loaded;
  }
  try {
    const data = assertJsonObject(
      readResolvedPackageConfigJson(exampleResolved, {
        publicRoot,
        env: opts.env,
        preprocess: opts.preprocess,
      }),
    );
    return {
      ok: true,
      missing: false,
      path: exampleResolved.path,
      rel: exampleRel,
      source: exampleResolved.source,
      data,
      resolved: exampleResolved,
    };
  } catch (e) {
    return {
      ok: false,
      missing: false,
      path: exampleResolved.path,
      rel: exampleRel,
      source: exampleResolved.source,
      error: /** @type {Error} */ (e).message,
      resolved: exampleResolved,
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
