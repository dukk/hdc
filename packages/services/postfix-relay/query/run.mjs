import { basename, dirname, join, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const cfgPath = join(here, "..", "config.json");

const inv = deployTargetInventory(root, target);
logDeployInventoryStatus(target, verb, inv);

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function loadCfg() {
  if (!existsSync(cfgPath)) return { ok: false, missing: true };
  try {
    return { ok: true, data: JSON.parse(readFileSync(cfgPath, "utf8")) };
  } catch (e) {
    return { ok: false, error: /** @type {Error} */ (e).message };
  }
}

const rel = relative(root, cfgPath).replace(/\\/g, "/");
const loaded = loadCfg();
const cfg = loaded.ok && isObject(loaded.data) ? loaded.data : null;
const mode = cfg && isObject(cfg.deploy) && typeof cfg.deploy.mode === "string" ? cfg.deploy.mode : null;
const relayhost =
  cfg && isObject(cfg.smtp) && typeof cfg.smtp.relayhost === "string" ? cfg.smtp.relayhost : null;

process.stderr.write(`[hdc] ${target} ${verb}: config ${rel} ${loaded.ok ? "loaded" : "not loaded"}.\n`);

const payload = {
  target,
  verb: "query",
  ok: Boolean(cfg && inv.ready),
  system_id: inv.systemId,
  config_path: rel,
  deploy_mode: mode,
  relayhost,
  message: cfg
    ? `Postfix relay config present (deploy.mode=${JSON.stringify(mode)}).`
    : `Copy packages/services/postfix-relay/config.example.json to config.json`,
};
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
