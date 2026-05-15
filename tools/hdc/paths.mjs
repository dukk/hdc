import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of `tools/`). */
export function repoRoot() {
  return join(__dirname, "..", "..");
}

export function automationDir(root = repoRoot()) {
  return join(root, "automation");
}

export function manuallyDeployedDir(root = repoRoot()) {
  return join(root, "docs", "manually-deployed");
}

/** Human-edited inventory sidecars: `inventory/manual/<category>/*.inventory.json`. */
export function inventoryManualDir(root = repoRoot()) {
  return join(root, "inventory", "manual");
}

/** Machine-maintained inventory snapshots (query/deploy, discovery). */
export function inventoryAutomatedDir(root = repoRoot()) {
  return join(root, "inventory", "automated");
}

/** Aggregated automated system records and per-plugin snapshots. */
export function inventoryAutomatedSystemsPath(root = repoRoot()) {
  return join(inventoryAutomatedDir(root), "systems.json");
}
