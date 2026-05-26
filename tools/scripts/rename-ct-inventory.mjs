#!/usr/bin/env node
/**
 * Rename inventory ct-prefixed system JSON files to unprefixed ids and update "id".
 * Usage: node tools/scripts/rename-ct-inventory.mjs [inventory-root]
 * Default inventory root: HDC_PRIVATE_ROOT/inventory or ../hdc-private/inventory
 */
import { existsSync, readFileSync, renameSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const hdcRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot =
  process.env.HDC_PRIVATE_ROOT?.trim() ||
  join(hdcRoot, "..", "hdc-private");
const inventoryRoot =
  process.argv[2]?.trim() || join(privateRoot, "inventory");

function walkJson(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJson(p, acc);
    else if (name.endsWith(".json")) acc.push(p);
  }
  return acc;
}

const slugMap = [
  ["ct-ollama", "ollama"],
  ["ct-pi-hole", "pi-hole"],
  ["ct-uptime-kuma", "uptime-kuma"],
  ["ct-solidtime", "solidtime"],
  ["ct-scanopy", "scanopy"],
  ["ct-gatus", "gatus"],
  ["ct-open-webui", "open-webui"],
  ["ct-nextcloud", "nextcloud"],
  ["ct-vaultwarden", "vaultwarden"],
  ["ct-postiz", "postiz"],
  ["ct-llama-cpp", "llama-cpp"],
  ["ct-nagios", "nagios"],
  ["ct-postfix-relay", "postfix-relay"],
];

function replaceIds(text) {
  let out = text;
  for (const [from, to] of slugMap) out = out.replaceAll(from, to);
  return out;
}

let renamed = 0;
let updated = 0;

for (const path of walkJson(inventoryRoot)) {
  const base = path.split(/[/\\]/).pop() || "";
  if (!base.startsWith("ct-")) continue;
  const newBase = replaceIds(base);
  const newPath = join(dirname(path), newBase);
  let raw = readFileSync(path, "utf8");
  const next = replaceIds(raw);
  if (next !== raw) {
    writeFileSync(path, next);
    updated++;
  }
  if (newPath !== path) {
    renameSync(path, newPath);
    renamed++;
    console.log(`${base} → ${newBase}`);
  }
}

for (const path of walkJson(inventoryRoot)) {
  if (path.split(/[/\\]/).pop()?.startsWith("ct-")) continue;
  let raw = readFileSync(path, "utf8");
  if (!raw.includes("ct-")) continue;
  const next = replaceIds(raw);
  if (next !== raw) {
    writeFileSync(path, next);
    updated++;
    console.log("updated refs in", path);
  }
}

console.log(`Done: ${renamed} renamed, ${updated} files patched under ${inventoryRoot}`);
