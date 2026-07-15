import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const DEFAULT_PRIVATE_DIR = "hdc-private";

const DEFAULT_COMPACT_ARRAY_KEYS = ["records", "port_forwards", "page_rules", "email_routing_rules"];

/**
 * @param {unknown} v
 */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} arr
 */
function isArrayOfPlainObjects(arr) {
  return Array.isArray(arr) && arr.every(isPlainObject);
}

/**
 * @param {number} level
 * @param {number} indent
 */
function pad(level, indent) {
  return " ".repeat(level * indent);
}

/**
 * @param {unknown} value
 * @param {number} level
 * @param {number} indent
 * @param {Set<string>} compactArrayKeys
 */
function formatValue(value, level, indent, compactArrayKeys) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return formatArray(value, level, indent, compactArrayKeys);
  }
  return formatObject(/** @type {Record<string, unknown>} */ (value), level, indent, compactArrayKeys);
}

/**
 * Single-line object with spaces after `{`, `,`, and before `}`.
 * @param {Record<string, unknown>} obj
 */
function stringifyCompactLineObject(obj) {
  const parts = Object.entries(obj).map(
    ([key, val]) => `${JSON.stringify(key)}: ${JSON.stringify(val)}`,
  );
  return `{ ${parts.join(", ")} }`;
}

/**
 * @param {unknown[]} arr
 * @param {number} level
 * @param {number} indent
 * @param {Set<string>} compactArrayKeys
 */
function formatCompactObjectArray(arr, level, indent) {
  if (arr.length === 0) return "[]";
  const inner = pad(level + 1, indent);
  const lines = arr.map(
    (item) => `${inner}${stringifyCompactLineObject(/** @type {Record<string, unknown>} */ (item))}`,
  );
  return `[\n${lines.join(",\n")}\n${pad(level, indent)}]`;
}

/**
 * @param {unknown[]} arr
 * @param {number} level
 * @param {number} indent
 * @param {Set<string>} compactArrayKeys
 */
function formatArray(arr, level, indent, compactArrayKeys) {
  if (arr.length === 0) return "[]";
  const itemPad = pad(level + 1, indent);
  const lines = arr.map((item) => {
    const formatted = formatValue(item, level + 1, indent, compactArrayKeys);
    if (!formatted.includes("\n")) {
      return `${itemPad}${formatted}`;
    }
    return formatted;
  });
  return `[\n${lines.join(",\n")}\n${pad(level, indent)}]`;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {number} level
 * @param {number} indent
 * @param {Set<string>} compactArrayKeys
 */
function formatObject(obj, level, indent, compactArrayKeys) {
  const entries = Object.entries(obj);
  if (entries.length === 0) return "{}";
  const inner = pad(level + 1, indent);
  const lines = entries.map(([key, val]) => {
    let formatted;
    if (Array.isArray(val) && compactArrayKeys.has(key) && isArrayOfPlainObjects(val)) {
      formatted = formatCompactObjectArray(val, level + 1, indent);
    } else if (isPlainObject(val)) {
      formatted = formatObject(/** @type {Record<string, unknown>} */ (val), level + 1, indent, compactArrayKeys);
    } else {
      formatted = formatValue(val, level + 1, indent, compactArrayKeys);
    }
    return `${inner}${JSON.stringify(key)}: ${formatted}`;
  });
  return `${pad(level, indent)}{\n${lines.join(",\n")}\n${pad(level, indent)}}`;
}

/**
 * Pretty-print JSON with selected object arrays compact (one object per line).
 * @param {unknown} data
 * @param {{ indent?: number; compactArrayKeys?: string[] }} [opts]
 * @returns {string}
 */
export function formatRepoJson(data, opts = {}) {
  const indent = opts.indent ?? 2;
  const keys = opts.compactArrayKeys ?? DEFAULT_COMPACT_ARRAY_KEYS;
  const compactArrayKeys = new Set(keys);
  return `${formatValue(data, 0, indent, compactArrayKeys)}\n`;
}

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
 * True when `dir` looks like an operator (hdc-private) workspace.
 * @param {string} dir
 */
export function looksLikeOperatorWorkspace(dir) {
  if (!dir || !existsSync(dir)) return false;
  return (
    existsSync(join(dir, "operations", "inventory")) ||
    existsSync(join(dir, "clumps", "services")) ||
    existsSync(join(dir, "clumps", "infrastructure"))
  );
}

/**
 * Resolve hdc-private root: HDC_PRIVATE_ROOT, else sibling ../hdc-private when it exists,
 * else cwd when it looks like an operator workspace (and is not a full hdc platform tree).
 * @param {string} publicRoot hdc repo / platform root
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function hdcPrivateRoot(publicRoot, env = process.env, cwd = process.cwd()) {
  const fromEnv =
    typeof env.HDC_PRIVATE_ROOT === "string" && env.HDC_PRIVATE_ROOT.trim()
      ? env.HDC_PRIVATE_ROOT.trim()
      : "";
  if (fromEnv) {
    const abs = resolve(cwd, fromEnv);
    return existsSync(abs) ? abs : null;
  }
  const sibling = resolve(publicRoot, "..", DEFAULT_PRIVATE_DIR);
  if (existsSync(sibling)) return sibling;

  const absCwd = resolve(cwd);
  if (looksLikeOperatorWorkspace(absCwd)) {
    // Never treat a full hdc platform checkout as the private workspace
    if (existsSync(join(absCwd, "apps", "hdc-cli", "paths.mjs"))) {
      return null;
    }
    return absCwd;
  }
  return null;
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
 * Default path for a new package operation report (prefer hdc-private when present).
 * @param {string} publicRoot hdc repo root
 * @param {string} clumpRoot absolute package directory under the public repo layout
 * @param {string} basename report filename (e.g. maintain-2026-05-26T12-00-00.md)
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Absolute path
 */
export function preferredClumpReportPath(publicRoot, clumpRoot, basename, env = process.env) {
  const rel = relative(publicRoot, join(clumpRoot, "reports", basename)).replace(/\\/g, "/");
  return preferredNewFilePath(publicRoot, rel, env);
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
 * @param {{ indent?: number; compactArrayKeys?: string[] }} [opts]
 */
export function writeResolvedRepoJson(resolved, data, opts = {}) {
  const dir = dirname(resolved.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolved.path, formatRepoJson(data, opts), "utf8");
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
