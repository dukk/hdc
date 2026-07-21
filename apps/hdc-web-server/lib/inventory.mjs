import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  AUTOMATED_DOMAINS,
  manualCategoryLegacyRels,
  manualCategoryRel,
  manualSidecarLegacyRels,
  manualSidecarRel,
} from "../../hdc-cli/lib/inventory-paths.mjs";
import { resolveDomainById } from "../../hdc-cli/lib/inventory-resolve.mjs";
import { hdcPrivateRoot, resolveRepoFile } from "../../hdc-cli/lib/private-repo.mjs";
import { primaryIpFromSystem } from "../../hdc-cli/lib/package/inventory-sidecar.mjs";

const VALID_CATEGORIES = new Set(["systems", "services", "networks", "targets", "domains"]);

/**
 * @param {string} absDir
 * @returns {string[]}
 */
function listJsonIdsInDir(absDir) {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => f.slice(0, -5));
}

/**
 * @param {string} publicRoot
 * @param {string} category
 */
function listCategoryIds(publicRoot, category) {
  const relDir = manualCategoryRel(category);
  const resolved = resolveRepoFile(publicRoot, relDir);
  let absDir = null;
  if (resolved.found) {
    absDir = resolved.path.replace(/[/\\][^/\\]+$/, "");
  } else {
    for (const legacyRel of manualCategoryLegacyRels(category)) {
      const legacy = resolveRepoFile(publicRoot, legacyRel);
      if (legacy.found) {
        absDir = legacy.path.replace(/[/\\][^/\\]+$/, "");
        break;
      }
    }
  }
  if (!absDir) {
    const privateRoot = resolved.privateRoot;
    absDir = privateRoot ? join(privateRoot, relDir) : join(publicRoot, relDir);
  }
  /** @type {Set<string>} */
  const ids = new Set(listJsonIdsInDir(absDir));

  if (category === "domains") {
    const privateRoot = hdcPrivateRoot(publicRoot);
    const autoDirs = [
      privateRoot ? join(privateRoot, AUTOMATED_DOMAINS) : null,
      join(publicRoot, AUTOMATED_DOMAINS),
    ].filter(Boolean);
    for (const d of autoDirs) {
      for (const id of listJsonIdsInDir(/** @type {string} */ (d))) ids.add(id);
    }
  }

  return [...ids].sort((a, b) => a.localeCompare(b));
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
  if (category === "domains") {
    if (typeof record.dns === "string") summary.dns = record.dns;
    if (typeof record.website === "boolean") summary.website = record.website;
    if (typeof record.mail === "string") summary.mail = record.mail;
    if (typeof record.renewal_usd === "number" || record.renewal_usd === null) {
      summary.renewal_usd = record.renewal_usd;
    }
    if (typeof record.expires_at === "string" || record.expires_at === null) {
      summary.expires_at = record.expires_at;
    }
    if (typeof record.purpose === "string") summary.purpose = record.purpose;
    if (typeof record.registrar === "string") summary.registrar = record.registrar;
    if (typeof record.notes === "string") summary.notes = record.notes;
  }
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

  if (category === "domains") {
    const merged = resolveDomainById(publicRoot, safeId);
    if (!merged) return { error: "not found" };
    return { category, id: safeId, record: merged, source: "merged" };
  }

  const candidates = [
    manualSidecarRel(category, safeId),
    ...manualSidecarLegacyRels(category, safeId),
  ];
  let pick = null;
  for (const rel of candidates) {
    const resolved = resolveRepoFile(publicRoot, rel);
    if (resolved.found) {
      pick = resolved;
      break;
    }
  }
  if (!pick) return { error: "not found" };

  try {
    const data = JSON.parse(readFileSync(pick.path, "utf8"));
    return { category, id: safeId, record: data, source: pick.source };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export { VALID_CATEGORIES };
