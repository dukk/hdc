#!/usr/bin/env node
/**
 * Add manifest.health blocks from service-health/families.mjs registries.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PORTS,
  HEALTH_PATHS,
  PACKAGE_FAMILIES,
} from "../../apps/hdc-cli/lib/package/service-health/families.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const clumpsDir = join(root, "clumps");

/** @param {string} dir */
function walkManifests(dir) {
  /** @type {string[]} */
  const out = [];
  for (const tier of ["clients", "infrastructure", "services"]) {
    const tierDir = join(dir, tier);
    if (!statSync(tierDir).isDirectory()) continue;
    for (const name of readdirSync(tierDir)) {
      const mf = join(tierDir, name, "manifest.json");
      try {
        if (statSync(mf).isFile()) out.push(mf);
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

let updated = 0;
for (const mfPath of walkManifests(clumpsDir)) {
  const mf = JSON.parse(readFileSync(mfPath, "utf8"));
  const id = typeof mf.id === "string" ? mf.id : mfPath.split(/[/\\]/).slice(-2, -1)[0];
  const path = HEALTH_PATHS[id];
  const port = DEFAULT_PORTS[id];
  const family = PACKAGE_FAMILIES[id];
  if (!path && !port && !family) continue;
  if (mf.health && typeof mf.health === "object") continue;

  /** @type {Record<string, unknown>} */
  const health = {};
  if (family) health.family = family;
  if (path) health.path = path;
  if (port) health.port = port;
  if (!Object.keys(health).length) continue;

  mf.health = health;
  writeFileSync(mfPath, `${JSON.stringify(mf, null, 2)}\n`, "utf8");
  updated++;
  console.error(mfPath);
}
console.error(`updated ${updated} manifests`);
