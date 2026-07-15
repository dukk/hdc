import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { manualCategoryRel } from "../../hdc-cli/lib/inventory-paths.mjs";
import { resolveRepoFile } from "../../hdc-cli/lib/private-repo.mjs";
import { primaryIpFromSystem } from "../../hdc-cli/lib/package/inventory-sidecar.mjs";

const VALID_CATEGORIES = new Set(["systems", "services", "networks", "targets"]);

/**
 * @param {string} publicRoot
 * @param {string} category
 */
function listCategoryIds(publicRoot, category) {
  const relDir = manualCategoryRel(category);
  const legacyDir = `inventory/manual/${category}`;
  const resolved = resolveRepoFile(publicRoot, relDir);
  const legacy = resolveRepoFile(publicRoot, legacyDir);
  const dir = resolved.found ? join(publicRoot, resolved.rel).replace(/\\/g, "/") : null;
  const privateRoot = resolved.privateRoot;
  const absDir = resolved.found
    ? resolved.path.replace(/[/\\][^/\\]+$/, "")
    : legacy.found
      ? legacy.path.replace(/[/\\][^/\\]+$/, "")
      : privateRoot
        ? join(privateRoot, relDir)
        : join(publicRoot, relDir);
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => f.slice(0, -5))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} category
 */
function inventorySummary(record, category) {
  const id = typeof record.id === "string" ? record.id : null;
  const kind = typeof record.kind === "string" ? record.kind : category.slice(0, -1);
  /** @type {Record<string, unknown>} */
  const summary = { id, kind };
  if (typeof record.hostname === "string") summary.hostname = record.hostname;
  if (typeof record.name === "string") summary.name = record.name;
  if (category === "systems") {
    const ip = primaryIpFromSystem(record);
    if (ip) summary.primary_ip = ip;
  }
  if (typeof record.system_class === "string") summary.system_class = record.system_class;
  return summary;
}

/**
 * @param {string} publicRoot
 * @param {string} _privateRoot
 * @param {string} category
 */
export async function listInventoryCategory(publicRoot, _privateRoot, category) {
  if (!VALID_CATEGORIES.has(category)) return { error: "invalid category", items: [] };
  const ids = listCategoryIds(publicRoot, category);
  const items = [];
  for (const id of ids) {
    const got = getInventoryRecord(publicRoot, _privateRoot, category, id);
    if (got.record && typeof got.record === "object") {
      items.push(inventorySummary(/** @type {Record<string, unknown>} */ (got.record), category));
    } else {
      items.push({ id, kind: category.slice(0, -1), parse_error: true });
    }
  }
  return { category, items };
}

/**
 * @param {string} publicRoot
 * @param {string} _privateRoot
 * @param {string} category
 * @param {string} id
 */
export function getInventoryRecord(publicRoot, _privateRoot, category, id) {
  if (!VALID_CATEGORIES.has(category)) return { error: "invalid category" };
  const safeId = String(id ?? "").trim();
  if (!safeId || safeId.includes("..") || safeId.includes("/") || safeId.includes("\\")) {
    return { error: "invalid id" };
  }

  const rel = `${manualCategoryRel(category)}/${safeId}.json`;
  const legacyRel = `inventory/manual/${category}/${safeId}.json`;
  const resolved = resolveRepoFile(publicRoot, rel);
  const legacy = resolveRepoFile(publicRoot, legacyRel);
  const pick = resolved.found ? resolved : legacy.found ? legacy : null;
  if (!pick) return { error: "not found" };

  try {
    const data = JSON.parse(readFileSync(pick.path, "utf8"));
    return { category, id: safeId, record: data, source: pick.source };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export { VALID_CATEGORIES };
