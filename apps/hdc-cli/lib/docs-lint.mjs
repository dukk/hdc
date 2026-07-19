import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { parseJsonc, readResolvedPackageConfigJson } from "./json-config-preprocess.mjs";

/**
 * @param {string} dir
 * @param {(name: string) => boolean} [filter]
 * @returns {string[]}
 */
function listFilesRecursive(dir, filter) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "reports") continue;
      out.push(...listFilesRecursive(p, filter));
    } else if (ent.isFile() && (!filter || filter(ent.name))) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Validate HDC JSON schemas and optionally inventory / config examples.
 *
 * Default mode fails only when a schema file is invalid JSON/JSONC or cannot
 * compile after registering sibling `$ref`s. Inventory and config.example checks
 * are warnings unless `strict` is true.
 *
 * @param {object} opts
 * @param {string} opts.publicRoot
 * @param {string | null} [opts.privateRoot]
 * @param {boolean} [opts.strict]
 * @param {(line: string) => void} [opts.log]
 * @returns {{
 *   ok: boolean;
 *   schemaCount: number;
 *   checked: number;
 *   errors: { path: string; message: string; level: 'error' | 'warning' }[];
 * }}
 */
export function runDocsLint(opts) {
  const { publicRoot, privateRoot = null, strict = false, log = () => {} } = opts;
  const schemaDir = join(publicRoot, "apps", "hdc-cli", "schema");
  const schemaFiles = listFilesRecursive(schemaDir, (n) => n.endsWith(".schema.json"));

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: false,
  });
  addFormats(ajv);

  /** @type {{ path: string; message: string; level: 'error' | 'warning' }[]} */
  const errors = [];
  /** @type {Map<string, object>} */
  const schemaByFile = new Map();

  for (const file of schemaFiles) {
    const key = basename(file);
    try {
      const schema = /** @type {Record<string, unknown>} */ (
        parseJsonc(readFileSync(file, "utf8"), key)
      );
      if (!schema.$id) {
        schema.$id = `https://hdc.local/schema/${key}`;
      }
      schemaByFile.set(key, schema);
      ajv.addSchema(schema);
    } catch (e) {
      errors.push({
        path: file,
        message: `schema parse failed: ${e instanceof Error ? e.message : String(e)}`,
        level: "error",
      });
    }
  }

  /** @type {Map<string, import("ajv").ValidateFunction>} */
  const validators = new Map();
  for (const [key, schema] of schemaByFile) {
    try {
      validators.set(key, ajv.compile(schema));
      log(`schema ok: ${key}`);
    } catch (e) {
      errors.push({
        path: join(schemaDir, key),
        message: `schema compile failed: ${e instanceof Error ? e.message : String(e)}`,
        level: "error",
      });
    }
  }

  /**
   * @param {string} filePath
   * @param {string} schemaKey
   * @param {'error' | 'warning'} level
   * @param {unknown} [data]
   */
  function checkAgainst(filePath, schemaKey, level, data) {
    const validate = validators.get(schemaKey);
    if (!validate) {
      errors.push({ path: filePath, message: `no schema loaded for ${schemaKey}`, level });
      return;
    }
    let payload = data;
    if (payload === undefined) {
      try {
        payload = parseJsonc(readFileSync(filePath, "utf8"), filePath);
      } catch (e) {
        errors.push({
          path: filePath,
          message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
          level,
        });
        return;
      }
    }
    const ok = validate(payload);
    if (!ok) {
      const detail = (validate.errors ?? [])
        .slice(0, 5)
        .map((err) => `${err.instancePath || "/"} ${err.message ?? "invalid"}`)
        .join("; ");
      errors.push({ path: filePath, message: detail || "schema validation failed", level });
    }
  }

  let checked = 0;
  const dataLevel = strict ? "error" : "warning";

  const exampleInventory = join(publicRoot, "operations", "inventory", "systems", "_example.json");
  try {
    if (statSync(exampleInventory).isFile()) {
      checkAgainst(exampleInventory, "inventory.system.schema.json", dataLevel);
      checked += 1;
    }
  } catch {
    /* optional */
  }

  /** @type {string[]} */
  const clumpsRoots = [];
  for (const candidate of [
    join(publicRoot, "..", "hdc-clumps"),
    join(publicRoot, "hdc-clumps"),
    join(publicRoot, "clumps"),
    privateRoot ? join(privateRoot, "clumps") : null,
  ]) {
    if (!candidate) continue;
    try {
      if (statSync(candidate).isDirectory()) clumpsRoots.push(candidate);
    } catch {
      /* optional */
    }
  }

  const seenExamples = new Set();
  for (const clumpsRoot of clumpsRoots) {
    const examples = listFilesRecursive(clumpsRoot, (n) => n === "config.example.json");
    for (const file of examples) {
      const rel = file.replace(/\\/g, "/");
      const m = /\/(clients|infrastructure|services)\/([^/]+)\/config\.example\.json$/.exec(rel);
      if (!m) continue;
      const id = m[2];
      const dedupe = `${m[1]}/${id}`;
      if (seenExamples.has(dedupe)) continue;
      seenExamples.add(dedupe);
      const schemaKey = `${id}.config.schema.json`;
      if (!validators.has(schemaKey)) continue;
      try {
        const data = readResolvedPackageConfigJson(
          {
            found: true,
            path: file,
            rel: `clumps/${m[1]}/${id}/config.example.json`,
            source: "public",
          },
          { publicRoot, env: process.env, preprocess: true },
        );
        checkAgainst(file, schemaKey, dataLevel, data);
        checked += 1;
      } catch (e) {
        errors.push({
          path: file,
          message: `example load failed: ${e instanceof Error ? e.message : String(e)}`,
          level: dataLevel,
        });
        checked += 1;
      }
    }
  }

  if (privateRoot) {
    for (const kind of ["systems", "networks", "services", "targets"]) {
      const dir = join(privateRoot, "operations", "inventory", kind);
      const schemaKey =
        kind === "systems"
          ? "inventory.system.schema.json"
          : kind === "networks"
            ? "inventory.network.schema.json"
            : kind === "services"
              ? "inventory.services.schema.json"
              : "inventory.target.schema.json";
      if (!validators.has(schemaKey)) continue;
      for (const file of listFilesRecursive(dir, (n) => n.endsWith(".json") && !n.startsWith("_"))) {
        checkAgainst(file, schemaKey, dataLevel);
        checked += 1;
      }
    }
  }

  const hardErrors = errors.filter((e) => e.level === "error");
  const warnings = errors.filter((e) => e.level === "warning");
  if (warnings.length) {
    log(`${warnings.length} warning(s) (use docs lint --strict to fail on these)`);
  }

  return {
    ok: hardErrors.length === 0,
    schemaCount: schemaFiles.length,
    checked,
    errors,
  };
}
