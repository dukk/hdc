import { basename, dirname, join, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";

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
const mode = cfg && isObject(cfg.deploy) && typeof cfg.deploy.mode === "string" ? cfg.deploy.mode : null;

process.stderr.write(`[hdc] ${target} query: config ${rel} ${loaded.ok ? "loaded" : "not loaded"}.\n`);

const payload = {
  target,
  verb: "query",
  ok: Boolean(cfg),
  config_path: rel,
  deploy_mode: mode,
  message: cfg
    ? `Ollama package config present (deploy.mode=${JSON.stringify(mode)}).`
    : `Copy packages/services/ollama/config.example.json to config.json (parse error: ${"error" in loaded ? loaded.error : "missing"}).`,
};
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
