/**
 * @param {string} systemId
 */
export function sanitizeAutomatedInventoryId(systemId) {
  const s = String(systemId)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "unknown";
}

/**
 * @param {string} name
 */
export function slugifyInventoryRole(name) {
  const s = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = s.slice(0, 72).replace(/-+$/, "");
  return trimmed || "unknown";
}

/**
 * @param {string} [letter] defaults to `a`
 */
function normalizeInstanceLetter(letter) {
  const s = String(letter ?? "a")
    .trim()
    .toLowerCase();
  return /^[a-z]+$/.test(s) ? s : "a";
}

/**
 * Physical system id (no class prefix): `pve-a`, `nas-primary`.
 * @param {string} roleSlug
 * @param {string} [instanceLetter]
 */
export function physicalSystemId(roleSlug, instanceLetter) {
  const slug = slugifyInventoryRole(roleSlug);
  const letter = normalizeInstanceLetter(instanceLetter);
  return `${slug}-${letter}`;
}

/**
 * @param {string} roleSlug
 * @param {string} [instanceLetter]
 */
export function vmSystemId(roleSlug, instanceLetter) {
  return `vm-${slugifyInventoryRole(roleSlug)}-${normalizeInstanceLetter(instanceLetter)}`;
}

/**
 * @param {string} roleSlug
 * @param {string} [instanceLetter]
 */
export function ctSystemId(roleSlug, instanceLetter) {
  return `ct-${slugifyInventoryRole(roleSlug)}-${normalizeInstanceLetter(instanceLetter)}`;
}

/**
 * @param {"physical" | "vm" | "ct" | "virt"} workloadClass
 * @param {string} roleSlug
 * @param {string} [instanceLetter]
 */
export function systemIdForClass(workloadClass, roleSlug, instanceLetter) {
  switch (workloadClass) {
    case "vm":
      return vmSystemId(roleSlug, instanceLetter);
    case "ct":
      return ctSystemId(roleSlug, instanceLetter);
    case "virt":
      return `virt-${slugifyInventoryRole(roleSlug)}-${normalizeInstanceLetter(instanceLetter)}`;
    case "physical":
    default:
      return physicalSystemId(roleSlug, instanceLetter);
  }
}

/**
 * @param {string} systemId
 */
export function manualSystemInventoryFileName(systemId) {
  return `${sanitizeAutomatedInventoryId(systemId)}.json`;
}
