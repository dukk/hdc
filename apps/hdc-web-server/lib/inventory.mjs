import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VALID_CATEGORIES = new Set(["systems", "services", "networks", "targets"]);

/**
 * @param {string} hdcRoot
 */
async function loadPrimaryIpHelper(hdcRoot) {
  try {
    const mod = await import(
      pathToFileURL(join(hdcRoot, "clumps", "lib", "inventory-sidecar.mjs")).href
    );
    return mod.primaryIpFromSystem;
  } catch {
    return () => null;
  }
}

/**
 * @param {string} publicRoot
 * @param {string} privateRoot
 * @param {string} category
 */
function inventoryDir(publicRoot, privateRoot, category) {
  if (!VALID_CATEGORIES.has(category)) return null;
  const privateDir = join(privateRoot, "inventory", "manual", category);
  if (existsSync(privateDir)) return privateDir;
  const publicDir = join(publicRoot, "inventory", "manual", category);
  if (existsSync(publicDir)) return publicDir;
  return privateDir;
}

/**
 * @param {string} dir
 */
function listJsonIds(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => f.slice(0, -5))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} category
 * @param {(s: unknown) => string | null} primaryIpFromSystem
 */
function inventorySummary(record, category, primaryIpFromSystem) {
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
 * @param {string} privateRoot
 * @param {string} category
 */
export async function listInventoryCategory(publicRoot, privateRoot, category) {
  const dir = inventoryDir(publicRoot, privateRoot, category);
  if (!dir) return { error: "invalid category", items: [] };
  const primaryIpFromSystem = await loadPrimaryIpHelper(publicRoot);
  const ids = listJsonIds(dir);
  const items = [];
  for (const id of ids) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
      if (raw && typeof raw === "object") {
        items.push(
          inventorySummary(/** @type {Record<string, unknown>} */ (raw), category, primaryIpFromSystem),
        );
      }
    } catch {
      items.push({ id, kind: category.slice(0, -1), parse_error: true });
    }
  }
  return { category, items };
}

/**
 * @param {string} publicRoot
 * @param {string} privateRoot
 * @param {string} category
 * @param {string} id
 */
export function getInventoryRecord(publicRoot, privateRoot, category, id) {
  if (!VALID_CATEGORIES.has(category)) return { error: "invalid category" };
  const safeId = String(id ?? "").trim();
  if (!safeId || safeId.includes("..") || safeId.includes("/") || safeId.includes("\\")) {
    return { error: "invalid id" };
  }

  const privatePath = join(privateRoot, "inventory", "manual", category, `${safeId}.json`);
  const publicPath = join(publicRoot, "inventory", "manual", category, `${safeId}.json`);

  let path = null;
  if (existsSync(privatePath)) path = privatePath;
  else if (existsSync(publicPath)) path = publicPath;
  else return { error: "not found" };

  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return { category, id: safeId, record: data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export { VALID_CATEGORIES };
