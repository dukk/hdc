import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isLocalOnlyVaultKey } from "./secret-backend.mjs";

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXPORT_FORMATS = new Set(["files", "env", "json"]);

/**
 * @typedef {"get" | "dump"} SecretsExportMode
 * @typedef {"files" | "env" | "json"} SecretsExportFormat
 */

/**
 * @typedef {object} ParsedSecretsExportArgv
 * @property {SecretsExportMode} mode
 * @property {string | null} key
 * @property {string | null} out
 * @property {string | null} outDir
 * @property {SecretsExportFormat} format
 * @property {string[]} keys
 * @property {boolean} includeBootstrap
 * @property {boolean} force
 * @property {boolean} dryRun
 */

/**
 * @param {string[]} argv Arguments after `secrets get|dump`.
 * @returns {ParsedSecretsExportArgv}
 */
export function parseSecretsExportArgv(argv) {
  const force = argv.includes("--force");
  const dryRun = argv.includes("--dry-run");
  const includeBootstrap = argv.includes("--include-bootstrap");

  /** @type {string[]} */
  const keys = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--key" && argv[i + 1]) {
      keys.push(argv[i + 1]);
      i++;
    }
  }

  let format = "files";
  const fi = argv.indexOf("--format");
  if (fi !== -1) {
    const f = argv[fi + 1];
    if (!f || !EXPORT_FORMATS.has(f)) {
      throw new Error(
        `secrets export: --format must be one of: ${[...EXPORT_FORMATS].join(", ")}`,
      );
    }
    format = /** @type {SecretsExportFormat} */ (f);
  }

  const outIdx = argv.indexOf("--out");
  const out = outIdx !== -1 ? (argv[outIdx + 1] ?? null) : null;
  const outDirIdx = argv.indexOf("--out-dir");
  const outDir = outDirIdx !== -1 ? (argv[outDirIdx + 1] ?? null) : null;

  const sub = argv[0];
  if (sub === "get") {
    const key = argv[1] && !argv[1].startsWith("-") ? argv[1] : null;
    return {
      mode: "get",
      key,
      out,
      outDir: null,
      format: "files",
      keys: [],
      includeBootstrap: true,
      force,
      dryRun,
    };
  }

  return {
    mode: "dump",
    key: null,
    out: null,
    outDir,
    format,
    keys,
    includeBootstrap,
    force,
    dryRun,
  };
}

/**
 * @param {Record<string, string>} all
 * @param {{ keys?: string[], includeBootstrap?: boolean }} opts
 * @returns {{ secrets: Record<string, string>, missing: string[] }}
 */
export function filterSecretsForExport(all, opts = {}) {
  const { keys = [], includeBootstrap = false } = opts;
  /** @type {Record<string, string>} */
  const secrets = {};
  for (const [k, v] of Object.entries(all)) {
    if (!includeBootstrap && isLocalOnlyVaultKey(k)) continue;
    if (typeof v !== "string" || v.length === 0) continue;
    secrets[k] = v;
  }

  if (keys.length === 0) {
    return { secrets, missing: [] };
  }

  /** @type {Record<string, string>} */
  const filtered = {};
  /** @type {string[]} */
  const missing = [];
  for (const k of keys) {
    if (k in secrets) filtered[k] = secrets[k];
    else missing.push(k);
  }
  return { secrets: filtered, missing };
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
export function formatEnvLine(key, value) {
  const needsQuote = /[\s#"\n=]/.test(value);
  if (!needsQuote) return `${key}=${value}`;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `${key}="${escaped}"`;
}

/**
 * @typedef {object} SecretsExportDeps
 * @property {(...args: unknown[]) => void} log
 * @property {(...args: unknown[]) => void} error
 * @property {typeof import("node:path").join} join
 * @property {typeof import("node:path").resolve} resolve
 * @property {typeof import("node:fs").existsSync} existsSync
 */

/**
 * @param {SecretsExportDeps} deps
 * @param {string} filePath
 * @param {string} content
 * @param {{ dryRun?: boolean, force?: boolean }} opts
 */
function writeExportFile(deps, filePath, content, opts) {
  const { dryRun = false, force = false } = opts;
  if (!dryRun && deps.existsSync(filePath) && !force) {
    throw new Error(`secrets export: output exists (use --force): ${filePath}`);
  }
  if (dryRun) {
    deps.log(`[dry-run] would write ${filePath}`);
    return;
  }
  const absPath = deps.resolve(filePath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(absPath, 0o600);
  } catch {
    // best-effort on Windows
  }
}

/**
 * @param {SecretsExportDeps} deps
 * @param {string} dirPath
 * @param {{ dryRun?: boolean }} opts
 */
function ensureExportDir(deps, dirPath, opts) {
  const { dryRun = false } = opts;
  if (dryRun) {
    deps.log(`[dry-run] would ensure directory ${dirPath}`);
    return false;
  }
  const existed = deps.existsSync(dirPath);
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  if (!existed) {
    try {
      chmodSync(dirPath, 0o700);
    } catch {
      // best-effort
    }
  }
  return !existed;
}

/**
 * @param {SecretsExportDeps} deps
 * @param {Record<string, string>} secrets
 * @param {ParsedSecretsExportArgv} parsed
 * @returns {{ written: number, destination: string }}
 */
export function writeSecretExport(deps, secrets, parsed) {
  const entries = Object.entries(secrets).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return { written: 0, destination: "" };
  }

  const { mode, format, force, dryRun } = parsed;

  if (mode === "get") {
    const key = parsed.key;
    const out = parsed.out;
    if (!key || !ENV_NAME_RE.test(key)) {
      throw new Error(
        "secrets get: need a valid ENV-style name (letters, digits, underscore)",
      );
    }
    if (!out) {
      throw new Error("secrets get: --out <path> is required");
    }
    const value = secrets[key];
    if (value === undefined) {
      throw new Error(`secrets get: no entry ${JSON.stringify(key)}`);
    }
    const filePath = deps.resolve(out);
    writeExportFile(deps, filePath, value, { dryRun, force });
    return { written: 1, destination: filePath };
  }

  const outDir = parsed.outDir;
  if (!outDir) {
    throw new Error("secrets dump: --out-dir <dir> is required");
  }
  const dirPath = deps.resolve(outDir);

  if (format === "files") {
    ensureExportDir(deps, dirPath, { dryRun });
    if (!dryRun) {
      for (const [k] of entries) {
        const p = deps.join(dirPath, k);
        if (deps.existsSync(p) && !force) {
          throw new Error(`secrets dump: output exists (use --force): ${p}`);
        }
      }
    } else {
      for (const [k] of entries) {
        deps.log(`[dry-run] would write ${deps.join(dirPath, k)}`);
      }
      return { written: entries.length, destination: dirPath };
    }
    for (const [k, v] of entries) {
      writeExportFile(deps, deps.join(dirPath, k), v, { dryRun: false, force });
    }
    return { written: entries.length, destination: dirPath };
  }

  ensureExportDir(deps, dirPath, { dryRun });
  const fileName = format === "env" ? "secrets.env" : "secrets.json";
  const filePath = deps.join(dirPath, fileName);
  const content =
    format === "env"
      ? `${entries.map(([k, v]) => formatEnvLine(k, v)).join("\n")}\n`
      : `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
  writeExportFile(deps, filePath, content, { dryRun, force });
  return { written: entries.length, destination: filePath };
}

export { ENV_NAME_RE };
