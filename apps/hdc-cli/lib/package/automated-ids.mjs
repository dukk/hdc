/**
 * Id slug helpers for package query output (no inventory paths).
 */

/**
 * @param {string} id
 */
export function sanitizeAutomatedInventoryId(id) {
  const s = String(id)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "unknown";
}

/**
 * @param {string} name
 */
export function slugifyInventoryName(name) {
  const s = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = s.slice(0, 72).replace(/-+$/, "");
  return trimmed || "unnamed";
}

/**
 * @param {string} prefix
 * @param {Record<string, unknown>} row
 * @param {Set<string>} usedIds
 */
export function automatedInventoryIdFromName(prefix, row, usedIds) {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const slug = slugifyInventoryName(name || "unnamed");
  let id = `${prefix}-${slug}`;
  if (!usedIds.has(id)) {
    usedIds.add(id);
    return id;
  }
  const rawId =
    typeof row._id === "string"
      ? row._id
      : typeof row.id === "string"
        ? row.id
        : "";
  const tail = rawId ? sanitizeAutomatedInventoryId(String(rawId)).slice(-6) : String(usedIds.size);
  id = `${prefix}-${slug}-${tail}`;
  while (usedIds.has(id)) {
    id = `${prefix}-${slug}-${tail}-${usedIds.size}`;
  }
  usedIds.add(id);
  return id;
}
