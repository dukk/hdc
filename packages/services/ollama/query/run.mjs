import { basename, dirname, join, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { listOllamaDeploymentSummaries, normalizeOllamaConfig } from "../lib/deployments.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const cfgPath = join(here, "..", "config.json");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function loadCfg() {
  if (!existsSync(cfgPath)) {
    return { ok: false, missing: true };
  }
  try {
    return { ok: true, data: JSON.parse(readFileSync(cfgPath, "utf8")) };
  } catch (e) {
    return { ok: false, error: /** @type {Error} */ (e).message };
  }
}

const root = repoRoot();
const rel = relative(root, cfgPath).replace(/\\/g, "/");
const loaded = loadCfg();
const cfg = loaded.ok && isObject(loaded.data) ? loaded.data : null;

process.stderr.write(`[hdc] ${target} query: config ${rel} ${loaded.ok ? "loaded" : "not loaded"}.\n`);

/** @type {unknown[]} */
let deployments = [];
/** @type {string | null} */
let configError = null;
let schemaVersion = null;

if (cfg) {
  try {
    const norm = normalizeOllamaConfig(cfg);
    schemaVersion = norm.schemaVersion;
    deployments = listOllamaDeploymentSummaries(cfg);
  } catch (e) {
    configError = String(/** @type {Error} */ (e).message || e);
  }
}

const defaultMode =
  cfg && isObject(cfg.defaults) && typeof cfg.defaults.mode === "string"
    ? cfg.defaults.mode
    : cfg && isObject(cfg.deploy) && typeof cfg.deploy.mode === "string"
      ? cfg.deploy.mode
      : null;

const payload = {
  target,
  verb: "query",
  ok: Boolean(cfg) && !configError,
  config_path: rel,
  schema_version: schemaVersion,
  deploy_mode: defaultMode,
  deployments,
  config_error: configError,
  message: configError
    ? `Config error: ${configError}`
    : cfg
      ? `${deployments.length} deployment(s) configured (default mode=${JSON.stringify(defaultMode)}). Deploy all: hdc run ollama deploy — or one: hdc run ollama deploy -- --instance <letter>`
      : `Copy packages/services/ollama/config.example.json to config.json (parse error: ${"error" in loaded ? loaded.error : "missing"}).`,
};
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
