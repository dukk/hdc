#!/usr/bin/env node
/**
 * Scaffold health verb for every clump under clumps/{services,infrastructure,clients}/.
 * Idempotent: adds verbs.health and health/run.mjs when missing.
 *
 * Usage: node tools/scripts/scaffold-health-verb.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGE_FAMILIES, resolveFamily } from "../../clumps/lib/service-health/families.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const TIERS = ["services", "infrastructure", "clients"];

const INFRA_API = new Set([
  "cloudflare",
  "cloudflare-workers",
  "discord",
  "twilio",
  "openrouter",
  "smtp2go",
  "uptimerobot",
  "gcp-oauth",
  "azure",
  "unifi-network",
  "azure-compute",
  "gcp-compute",
  "oci-compute",
  "aws",
]);

const CLIENTS = new Set(["windows", "ubuntu", "raspberrypi", "client-ubuntu"]);
const SELF_EDGE = new Set(["nginx-waf", "nginx"]);
const SYNOLOGY = new Set(["plex", "synology-nas"]);

/**
 * @param {string} packageId
 * @param {string} tier
 */
function familyFor(packageId, tier) {
  if (PACKAGE_FAMILIES[packageId]) return PACKAGE_FAMILIES[packageId];
  if (CLIENTS.has(packageId) || tier === "clients") return "client";
  if (INFRA_API.has(packageId)) return "infra-api";
  if (SELF_EDGE.has(packageId)) return "self-edge";
  if (SYNOLOGY.has(packageId)) return "synology";
  if (tier === "infrastructure") return "infra-api";
  return resolveFamily(packageId);
}

/**
 * @param {string} packageId
 * @param {string} family
 * @param {string} depthRel import depth from health/ to clumps/lib (services = ../../../lib)
 */
function healthScript(packageId, family, importPath) {
  const familyLit = JSON.stringify(family);
  return `#!/usr/bin/env node
/**
 * Health check for ${packageId} (layered DNS / WAF / direct / guest).
 *
 * Usage: hdc run ${packageId} health -- [--instance a]
 */
import { runServiceHealth, clumpRootFromHealthScript } from "${importPath}/service-health/run-health.mjs";

const payload = await runServiceHealth({
  clumpRoot: clumpRootFromHealthScript(import.meta.url),
  packageId: ${JSON.stringify(packageId)},
  family: ${familyLit},
});
process.exit(payload.ok ? 0 : 1);
`;
}

let addedManifest = 0;
let addedScript = 0;
let skipped = 0;

for (const tier of TIERS) {
  const tierDir = join(root, "clumps", tier);
  if (!existsSync(tierDir)) continue;
  // import path from clumps/<tier>/<id>/health/run.mjs → clumps/lib
  const importPath = "../../../lib";
  for (const name of readdirSync(tierDir).sort()) {
    const clumpDir = join(tierDir, name);
    const mfPath = join(clumpDir, "manifest.json");
    if (!existsSync(mfPath)) continue;
    let mf;
    try {
      mf = JSON.parse(readFileSync(mfPath, "utf8"));
    } catch {
      console.error(`skip broken manifest ${mfPath}`);
      continue;
    }
    if (!mf.verbs || typeof mf.verbs !== "object") mf.verbs = {};
    const packageId = typeof mf.id === "string" ? mf.id : name;
    const family = familyFor(packageId, tier);

    let wroteManifest = false;
    if (!mf.verbs.health) {
      mf.verbs.health = { script: "run.mjs" };
      // Keep stable key order: deploy, maintain, query, health, teardown when present
      const order = ["deploy", "maintain", "query", "health", "teardown"];
      /** @type {Record<string, unknown>} */
      const verbs = {};
      for (const k of order) {
        if (mf.verbs[k]) verbs[k] = mf.verbs[k];
      }
      for (const [k, v] of Object.entries(mf.verbs)) {
        if (!verbs[k]) verbs[k] = v;
      }
      mf.verbs = verbs;
      writeFileSync(mfPath, `${JSON.stringify(mf, null, 2)}\n`, "utf8");
      addedManifest++;
      wroteManifest = true;
    }

    const healthDir = join(clumpDir, "health");
    const runPath = join(healthDir, "run.mjs");
    if (!existsSync(runPath)) {
      mkdirSync(healthDir, { recursive: true });
      writeFileSync(runPath, healthScript(packageId, family, importPath), "utf8");
      addedScript++;
    } else if (!wroteManifest) {
      skipped++;
    }
  }
}

console.error(
  `scaffold-health-verb: manifests+=${addedManifest} scripts+=${addedScript} already_ok~=${skipped}`,
);
