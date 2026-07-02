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
 * Physical system id (no class prefix): `hypervisor-a`, `nas-primary`.
 * @param {string} roleSlug
 * @param {string} [instanceLetter]
 */
export function physicalSystemId(roleSlug, instanceLetter) {
  const slug = slugifyInventoryRole(roleSlug);
  const letter = normalizeInstanceLetter(instanceLetter);
  return `${slug}-${letter}`;
}

/**
 * LXC / Proxmox container id (unprefixed): `ollama-a`, `pi-hole-b`.
 * @param {string} roleSlug
 * @param {string} [instanceLetter]
 */
export function lxcSystemId(roleSlug, instanceLetter) {
  return physicalSystemId(roleSlug, instanceLetter);
}

/**
 * @param {string} roleSlug
 * @param {string} [instanceLetter]
 */
export function vmSystemId(roleSlug, instanceLetter) {
  return `vm-${slugifyInventoryRole(roleSlug)}-${normalizeInstanceLetter(instanceLetter)}`;
}

/**
 * @deprecated Use {@link lxcSystemId} — returns unprefixed ids (no `ct-` prefix).
 * @param {string} roleSlug
 * @param {string} [instanceLetter]
 */
export function ctSystemId(roleSlug, instanceLetter) {
  return lxcSystemId(roleSlug, instanceLetter);
}

/**
 * Regex for unprefixed LXC deployment system_id for a role slug.
 * @param {string} roleSlug
 */
export function deploymentSystemIdPattern(roleSlug) {
  const slug = slugifyInventoryRole(roleSlug);
  return new RegExp(`^${slug}-[a-z]+$`);
}

/** Uptime Kuma: `uptime-kuma-a` (LAN) or `uptime-kuma-ext-a` (external/OCI). */
export function uptimeKumaDeploymentSystemIdPattern() {
  return /^uptime-kuma(-ext)?-[a-z]+$/;
}

/**
 * @param {string} systemId
 * @param {string} roleSlug
 */
export function assertUnprefixedLxcSystemId(systemId, roleSlug) {
  const sid = String(systemId ?? "").trim();
  if (/^(ct|vm)-/.test(sid)) {
    throw new Error(
      `system_id ${JSON.stringify(sid)} must be unprefixed ${slugifyInventoryRole(roleSlug)}-<letter> (no ct- or vm-)`,
    );
  }
  if (!deploymentSystemIdPattern(roleSlug).test(sid)) {
    throw new Error(
      `system_id ${JSON.stringify(sid)} must match ${slugifyInventoryRole(roleSlug)}-<letter>`,
    );
  }
}

/**
 * Proxmox LXC hostname from system id (strips legacy `ct-` prefix if present).
 * @param {string} systemId
 */
export function lxcHostnameFromSystemId(systemId) {
  return String(systemId ?? "")
    .trim()
    .replace(/^ct-/, "")
    .slice(0, 63);
}

/**
 * @param {"physical" | "vm" | "ct" | "lxc" | "virt"} workloadClass
 * @param {string} roleSlug
 * @param {string} [instanceLetter]
 */
export function systemIdForClass(workloadClass, roleSlug, instanceLetter) {
  switch (workloadClass) {
    case "vm":
      return vmSystemId(roleSlug, instanceLetter);
    case "ct":
    case "lxc":
      return lxcSystemId(roleSlug, instanceLetter);
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
