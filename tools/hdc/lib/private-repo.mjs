import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const DEFAULT_PRIVATE_DIR = "hdc-private";

/**
 * @param {unknown} v
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Normalize a repo-relative path (forward slashes, no leading ./).
 * @param {string} relPath
 */
export function normalizeRepoRelPath(relPath) {
  const raw = typeof relPath === "string" ? relPath.trim() : "";
  if (!raw) {
    throw new Error("relPath is required");
  }
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error(`relPath must be repo-relative, not absolute: ${raw}`);
  }
  return raw.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Resolve hdc-private root: HDC_PRIVATE_ROOT, else sibling ../hdc-private when it exists.
 * @param {string} publicRoot hdc repo root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function hdcPrivateRoot(publicRoot, env = process.env) {
  const fromEnv =
    typeof env.HDC_PRIVATE_ROOT === "string" && env.HDC_PRIVATE_ROOT.trim()
      ? env.HDC_PRIVATE_ROOT.trim()
      : "";
  if (fromEnv) {
    const abs = resolve(fromEnv);
    return existsSync(abs) ? abs : null;
  }
  const sibling = resolve(publicRoot, "..", DEFAULT_PRIVATE_DIR);
  return existsSync(sibling) ? sibling : null;
}

/**
 * @typedef {"public" | "private" | "missing"} RepoFileSource
 */

/**
 * @typedef {object} ResolvedRepoFile
 * @property {string} path Absolute path to use (public or private)
 * @property {string} rel Repo-relative path (normalized)
 * @property {boolean} found
 * @property {RepoFileSource} source
 * @property {string | null} privateRoot Absolute hdc-private root when used or available
 * @property {string} publicPath Absolute path under public repo
 */

/**
 * Resolve a repo-relative file: public hdc first, then hdc-private.
 * @param {string} publicRoot
 * @param {string} relPath
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ResolvedRepoFile}
 */
export function resolveRepoFile(publicRoot, relPath, env = process.env) {
  const rel = normalizeRepoRelPath(relPath);
  const publicPath = join(publicRoot, rel);
  const privateRoot = hdcPrivateRoot(publicRoot, env);

  if (existsSync(publicPath)) {
    return {
      path: publicPath,
      rel,
      found: true,
      source: "public",
      privateRoot,
      publicPath,
    };
  }

  if (privateRoot) {
    const privatePath = join(privateRoot, rel);
    if (existsSync(privatePath)) {
      return {
        path: privatePath,
        rel,
        found: true,
        source: "private",
        privateRoot,
        publicPath,
      };
    }
  }

  return {
    path: publicPath,
    rel,
    found: false,
    source: "missing",
    privateRoot,
    publicPath,
  };
}

/**
 * Prefer writing new files to hdc-private when that repo is available.
 * @param {string} publicRoot
 * @param {string} relPath
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Absolute path
 */
export function preferredNewFilePath(publicRoot, relPath, env = process.env) {
  const rel = normalizeRepoRelPath(relPath);
  const privateRoot = hdcPrivateRoot(publicRoot, env);
  if (privateRoot) {
    return join(privateRoot, rel);
  }
  return join(publicRoot, rel);
}

/**
 * Human-readable label for stderr (repo-relative + source).
 * @param {ResolvedRepoFile} resolved
 * @param {string} publicRoot
 */
export function formatResolvedRepoFileLabel(resolved, publicRoot) {
  const rel = resolved.rel.replace(/\\/g, "/");
  if (resolved.source === "private" && resolved.privateRoot) {
    const privRel = relative(resolved.privateRoot, resolved.path).replace(/\\/g, "/");
    return `${rel} (hdc-private:${privRel})`;
  }
  if (resolved.source === "public") {
    return rel;
  }
  return rel;
}

/**
 * @param {ResolvedRepoFile} resolved
 * @param {{ exampleRel?: string; label?: string }} [opts]
 */
export function missingRepoFileError(resolved, opts = {}) {
  const label = opts.label ?? resolved.rel;
  const example = opts.exampleRel ? ` — copy ${opts.exampleRel}` : "";
  const privateHint = resolved.privateRoot
    ? ` or add it under hdc-private with the same path`
    : ` (clone hdc-private beside hdc or set HDC_PRIVATE_ROOT)`;
  return new Error(`Missing ${label}${example}${privateHint}`);
}

/**
 * @param {ResolvedRepoFile} resolved
 * @returns {unknown}
 */
export function readResolvedRepoJson(resolved) {
  if (!resolved.found) {
    throw missingRepoFileError(resolved);
  }
  const raw = readFileSync(resolved.path, "utf8");
  return JSON.parse(raw);
}

/**
 * @param {ResolvedRepoFile} resolved
 * @param {unknown} data
 * @param {{ indent?: number }} [opts]
 */
export function writeResolvedRepoJson(resolved, data, opts = {}) {
  const indent = opts.indent ?? 2;
  const dir = dirname(resolved.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolved.path, `${JSON.stringify(data, null, indent)}\n`, "utf8");
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function assertJsonObject(raw) {
  if (!isObject(raw)) {
    throw new Error("config must be a JSON object");
  }
  return /** @type {Record<string, unknown>} */ (raw);
}

/**
 * Resolve absolute path that may be repo-relative or absolute.
 * @param {string} publicRoot
 * @param {string} pathOrRel
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ResolvedRepoFile}
 */
export function resolveRepoFilePath(publicRoot, pathOrRel, env = process.env) {
  const raw = typeof pathOrRel === "string" ? pathOrRel.trim() : "";
  if (!raw) {
    throw new Error("path is required");
  }
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) {
    const found = existsSync(raw);
    return {
      path: raw,
      rel: raw.replace(/\\/g, "/"),
      found,
      source: found ? "public" : "missing",
      privateRoot: hdcPrivateRoot(publicRoot, env),
      publicPath: raw,
    };
  }
  return resolveRepoFile(publicRoot, raw, env);
}
