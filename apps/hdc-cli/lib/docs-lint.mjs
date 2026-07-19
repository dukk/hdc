import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

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
 * @param {string} path
 * @returns {unknown}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Validate all JSON Schema files under apps/hdc-cli/schema and (when present)
 * hdc-private inventory + clump config.example.json files against matching schemas.
 *
 * @param {object} opts
 * @param {string} opts.publicRoot
 * @param {string | null} [opts.privateRoot]
 * @param {(line: string) => void} [opts.log]
 * @returns {{ ok: boolean; schemaCount: number; checked: number; errors: { path: string; message: string }[] }}
 */
export function runDocsLint(opts) {
  const { publicRoot, privateRoot = null, log = () => {} } = opts;
  const schemaDir = join(publicRoot, "apps", "hdc-cli", "schema");
  const schemaFiles = listFilesRecursive(schemaDir, (n) => n.endsWith(".schema.json"));

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: false,
  });
  addFormats(ajv);

  /** @type {{ path: string; message: string }[]} */
  const errors = [];
  /** @type {Map<string, import("ajv").ValidateFunction>} */
  const validators = new Map();

  for (const file of schemaFiles) {
    try {
      const schema = readJson(file);
      const validate = ajv.compile(schema);
      const key = file.replace(/\\/g, "/").split("/schema/").pop() ?? file;
      validators.set(key, validate);
      log(`schema ok: ${key}`);
    } catch (e) {
      errors.push({
        path: file,
        message: `schema compile failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  /**
   * @param {string} filePath
   * @param {string} schemaKey
   */
  function checkAgainst(filePath, schemaKey) {
    const validate = validators.get(schemaKey);
    if (!validate) {
      errors.push({ path: filePath, message: `no schema loaded for ${schemaKey}` });
      return;
    }
    let data;
    try {
      data = readJson(filePath);
    } catch (e) {
      errors.push({
        path: filePath,
        message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    const ok = validate(data);
    if (!ok) {
      const detail = (validate.errors ?? [])
        .slice(0, 5)
        .map((err) => `${err.instancePath || "/"} ${err.message ?? "invalid"}`)
        .join("; ");
      errors.push({ path: filePath, message: detail || "schema validation failed" });
    }
  }

  let checked = 0;

  // Public example inventories / configs
  const exampleInventory = join(publicRoot, "operations", "inventory", "systems", "_example.json");
  try {
    if (statSync(exampleInventory).isFile()) {
      checkAgainst(exampleInventory, "inventory.system.schema.json");
      checked += 1;
    }
  } catch {
    /* optional */
  }

  const clumpsRoots = [join(publicRoot, "clumps")];
  if (privateRoot) clumpsRoots.push(join(privateRoot, "clumps"));

  // Prefer hdc-clumps sibling for examples
  const siblingClumps = join(publicRoot, "..", "hdc-clumps");
  try {
    if (statSync(siblingClumps).isDirectory()) clumpsRoots.unshift(siblingClumps);
  } catch {
    /* optional */
  }

  for (const clumpsRoot of clumpsRoots) {
    const examples = listFilesRecursive(clumpsRoot, (n) => n === "config.example.json");
    for (const file of examples) {
      const rel = file.replace(/\\/g, "/");
      const m = /\/(clients|infrastructure|services)\/([^/]+)\/config\.example\.json$/.exec(rel);
      if (!m) continue;
      const id = m[2];
      const schemaKey = `${id}.config.schema.json`;
      if (!validators.has(schemaKey)) continue;
      checkAgainst(file, schemaKey);
      checked += 1;
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
        checkAgainst(file, schemaKey);
        checked += 1;
      }
    }
  }

  return {
    ok: errors.length === 0,
    schemaCount: schemaFiles.length,
    checked,
    errors,
  };
}
