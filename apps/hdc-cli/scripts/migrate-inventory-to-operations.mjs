#!/usr/bin/env node
/**
 * Migrate hdc-private inventory/manual → operations/inventory (and automated).
 * Legacy steps: inventory/manual → operations/manual, then operations/manual → operations/inventory.
 */
import { existsSync, mkdirSync, renameSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const privateRoot = process.argv.includes("--private-root")
  ? process.argv[process.argv.indexOf("--private-root") + 1]
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "hdc-private");

const dryRun = process.argv.includes("--dry-run");

const moves = [
  ["inventory/manual", "operations/manual"],
  ["inventory/automated", "operations/automated"],
  ["operations/manual", "operations/inventory"],
];

for (const [from, to] of moves) {
  const src = join(privateRoot, from);
  const dest = join(privateRoot, to);
  if (!existsSync(src)) continue;
  console.error(`${dryRun ? "would move" : "moving"} ${src} → ${dest}`);
  if (!dryRun) {
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(src, dest);
  }
}

const emptyInventory = join(privateRoot, "inventory");
if (!dryRun && existsSync(emptyInventory)) {
  const remaining = readdirSync(emptyInventory);
  if (!remaining.length) {
    console.error(`removing empty ${emptyInventory}`);
    // rmdir on windows needs recursive only if non-empty
    try {
      renameSync(emptyInventory, join(privateRoot, ".inventory-migrated-empty"));
    } catch {
      /* ignore */
    }
  }
}

console.error("done");
