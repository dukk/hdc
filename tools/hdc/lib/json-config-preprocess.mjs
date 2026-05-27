import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import { repoRoot } from "../paths.mjs";
import {
  missingRepoFileError,
  normalizeRepoRelPath,
  resolveRepoFile,
} from "./private-repo.mjs";

export const HDC_INCLUDE_KEY = "$hdc.include";

/**
 * @typedef {import("./private-repo.mjs").ResolvedRepoFile} ResolvedRepoFile
 */

/**
 * @typedef {object} PreprocessContext
 * @property {string} publicRoot
 * @property {NodeJS.ProcessEnv} env
 * @property {string} baseRel Repo-relative path of the file being processed
 * @property {Set<string>} visited Absolute paths already being included (cycle detection)
 */

/**
 * Remove line and block comments outside JSON strings.
 * @param {string} text
 * @returns {string}
 */
export function stripJsonc(text) {
  /** @type {string[]} */
  const out = [];
  let i = 0;
  const len = text.length;
  let inString = false;
  let escaped = false;

  while (i < len) {
    const c = text[i];

    if (inString) {
      out.push(c);
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (c === '"') {
      inString = true;
      out.push(c);
      i += 1;
      continue;
    }

    if (c === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < len && text[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < len && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }

    out.push(c);
    i += 1;
  }

  return stripTrailingCommas(out.join(""));
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripTrailingCommas(text) {
  /** @type {string[]} */
  const out = [];
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < text.length) {
    const c = text[i];

    if (inString) {
      out.push(c);
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (c === '"') {
      inString = true;
      out.push(c);
      i += 1;
      continue;
    }

    if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) {
        j += 1;
      }
      if (text[j] === "}" || text[j] === "]") {
        i += 1;
        continue;
      }
    }

    out.push(c);
    i += 1;
  }

  return out.join("");
}

/**
 * @param {string} text
 * @param {string} [label]
 * @returns {unknown}
 */
export function parseJsonc(text, label = "config") {
  const stripped = stripJsonc(text);
  try {
    return JSON.parse(stripped);
  } catch (e) {
    const msg = /** @type {Error} */ (e).message;
    throw new Error(`${label}: JSON parse failed: ${msg}`);
  }
}

/**
 * @param {unknown} v
 */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} directive
 * @returns {string}
 */
function includePathFromDirective(directive) {
  if (!isPlainObject(directive)) {
    throw new Error("$hdc.include value must be a string or { file: string }");
  }
  const raw = directive[HDC_INCLUDE_KEY];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (isPlainObject(raw) && typeof raw.file === "string" && raw.file.trim()) {
    return raw.file.trim();
  }
  throw new Error("$hdc.include requires a non-empty file path");
}

/**
 * @param {string} baseRel
 * @param {string} includeFile
 * @returns {string}
 */
export function resolveIncludeRelPath(baseRel, includeFile) {
  const baseDir = dirname(normalizeRepoRelPath(baseRel));
  const combined =
    baseDir === "." || baseDir === ""
      ? includeFile.replace(/\\/g, "/")
      : `${baseDir}/${includeFile.replace(/\\/g, "/")}`;

  /** @type {string[]} */
  const stack = [];
  for (const part of combined.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (stack.length === 0) {
        throw new Error(`include path escapes repo root: ${includeFile} (from ${baseRel})`);
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

/**
 * @param {Record<string, unknown>} obj
 */
function assertIncludeDirectiveOnly(obj) {
  const keys = Object.keys(obj);
  if (keys.length !== 1 || keys[0] !== HDC_INCLUDE_KEY) {
    throw new Error("$hdc.include object must not contain other keys");
  }
}

/**
 * @param {Record<string, unknown>} directive
 * @param {PreprocessContext} ctx
 * @returns {unknown}
 */
function loadIncludeFile(directive, ctx) {
  assertIncludeDirectiveOnly(directive);
  const includeFile = includePathFromDirective(directive);
  const includeRel = resolveIncludeRelPath(ctx.baseRel, includeFile);
  const resolved = resolveRepoFile(ctx.publicRoot, includeRel, ctx.env);
  if (!resolved.found) {
    throw missingRepoFileError(resolved, { label: `include ${includeRel} (from ${ctx.baseRel})` });
  }

  const abs = resolved.path;
  if (ctx.visited.has(abs)) {
    throw new Error(`circular $hdc.include: ${includeRel} (from ${ctx.baseRel})`);
  }

  ctx.visited.add(abs);
  try {
    const raw = readFileSync(abs, "utf8");
    const childCtx = { ...ctx, baseRel: resolved.rel };
    return preprocessPackageConfigText(raw, childCtx);
  } finally {
    ctx.visited.delete(abs);
  }
}

/**
 * @param {unknown} value
 * @param {PreprocessContext} ctx
 * @returns {unknown}
 */
export function expandHdcIncludes(value, ctx) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    /** @type {unknown[]} */
    const out = [];
    for (const item of value) {
      if (isPlainObject(item) && HDC_INCLUDE_KEY in item) {
        assertIncludeDirectiveOnly(item);
        const included = loadIncludeFile(item, ctx);
        if (Array.isArray(included)) {
          for (const el of included) {
            out.push(expandHdcIncludes(el, ctx));
          }
        } else {
          out.push(expandHdcIncludes(included, ctx));
        }
      } else {
        out.push(expandHdcIncludes(item, ctx));
      }
    }
    return out;
  }

  const obj = /** @type {Record<string, unknown>} */ (value);
  if (HDC_INCLUDE_KEY in obj) {
    assertIncludeDirectiveOnly(obj);
    const included = loadIncludeFile(obj, ctx);
    return expandHdcIncludes(included, ctx);
  }

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    out[key] = expandHdcIncludes(val, ctx);
  }
  return out;
}

/**
 * @param {string} text
 * @param {PreprocessContext} ctx
 * @returns {unknown}
 */
export function preprocessPackageConfigText(text, ctx) {
  const label = ctx.baseRel || "config";
  const parsed = parseJsonc(text, label);
  return expandHdcIncludes(parsed, ctx);
}

/**
 * @param {PreprocessContext} ctx
 * @returns {PreprocessContext}
 */
export function createPreprocessContext(ctx = {}) {
  return {
    publicRoot: ctx.publicRoot ?? repoRoot(),
    env: ctx.env ?? process.env,
    baseRel: ctx.baseRel ?? "config.json",
    visited: ctx.visited ?? new Set(),
  };
}

/**
 * Read and preprocess a resolved package config file (JSONC + $hdc.include).
 * @param {ResolvedRepoFile} resolved
 * @param {{ publicRoot?: string; env?: NodeJS.ProcessEnv; preprocess?: boolean }} [opts]
 * @returns {unknown}
 */
export function readResolvedPackageConfigJson(resolved, opts = {}) {
  if (!resolved.found) {
    throw missingRepoFileError(resolved);
  }

  const raw = readFileSync(resolved.path, "utf8");
  if (opts.preprocess === false) {
    return JSON.parse(raw);
  }

  const ctx = createPreprocessContext({
    publicRoot: opts.publicRoot ?? repoRoot(),
    env: opts.env,
    baseRel: resolved.rel,
  });
  return preprocessPackageConfigText(raw, ctx);
}
