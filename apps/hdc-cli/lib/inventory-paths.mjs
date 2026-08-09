/** Repo-relative inventory path constants (under operations/). */

export const MANUAL_SYSTEMS = "operations/inventory/systems";
export const MANUAL_SERVICES = "operations/inventory/services";
export const MANUAL_NETWORKS = "operations/inventory/networks";
export const MANUAL_TARGETS = "operations/inventory/targets";
export const MANUAL_DOMAINS = "operations/inventory/domains";

export const AUTOMATED_SYSTEMS = "operations/automated/systems";
export const AUTOMATED_NETWORKS = "operations/automated/networks";
export const AUTOMATED_POLICIES = "operations/automated/policies";
export const AUTOMATED_DOMAINS = "operations/automated/domains";

/** Allowed `system_class` values → subdirectory under MANUAL_SYSTEMS. */
export const SYSTEM_CLASSES = Object.freeze(["physical", "virtual"]);

/** @deprecated Use MANUAL_SYSTEMS */
export const LEGACY_OPERATIONS_MANUAL_SYSTEMS = "operations/manual/systems";

/** @deprecated Use MANUAL_SERVICES */
export const LEGACY_OPERATIONS_MANUAL_SERVICES = "operations/manual/services";

/** @deprecated Use MANUAL_NETWORKS */
export const LEGACY_OPERATIONS_MANUAL_NETWORKS = "operations/manual/networks";

/** @deprecated Use MANUAL_TARGETS */
export const LEGACY_OPERATIONS_MANUAL_TARGETS = "operations/manual/targets";

/** @deprecated Use MANUAL_SYSTEMS */
export const LEGACY_MANUAL_SYSTEMS = "inventory/manual/systems";

/** @deprecated Use MANUAL_SERVICES */
export const LEGACY_MANUAL_SERVICES = "inventory/manual/services";

/** @deprecated Use MANUAL_NETWORKS */
export const LEGACY_MANUAL_NETWORKS = "inventory/manual/networks";

/** @deprecated Use MANUAL_TARGETS */
export const LEGACY_MANUAL_TARGETS = "inventory/manual/targets";

/**
 * Normalize / validate system_class for path use.
 * @param {unknown} systemClass
 * @returns {"physical"|"virtual"|null}
 */
export function normalizeSystemClass(systemClass) {
  if (typeof systemClass !== "string") return null;
  const t = systemClass.trim().toLowerCase();
  return SYSTEM_CLASSES.includes(t) ? /** @type {"physical"|"virtual"} */ (t) : null;
}

/**
 * Resolve a manual inventory category path with legacy fallback.
 * @param {string} category systems | services | networks | targets | domains
 */
export function manualCategoryRel(category) {
  switch (category) {
    case "systems":
      return MANUAL_SYSTEMS;
    case "services":
      return MANUAL_SERVICES;
    case "networks":
      return MANUAL_NETWORKS;
    case "targets":
      return MANUAL_TARGETS;
    case "domains":
      return MANUAL_DOMAINS;
    default:
      throw new Error(`unknown inventory category: ${category}`);
  }
}

/**
 * Legacy category dirs to scan when canonical path is missing.
 * @param {"systems"|"services"|"networks"|"targets"|"domains"} category
 * @returns {string[]}
 */
export function manualCategoryLegacyRels(category) {
  switch (category) {
    case "systems":
      return [LEGACY_OPERATIONS_MANUAL_SYSTEMS, LEGACY_MANUAL_SYSTEMS];
    case "services":
      return [LEGACY_OPERATIONS_MANUAL_SERVICES, LEGACY_MANUAL_SERVICES];
    case "networks":
      return [LEGACY_OPERATIONS_MANUAL_NETWORKS, LEGACY_MANUAL_NETWORKS];
    case "targets":
      return [LEGACY_OPERATIONS_MANUAL_TARGETS, LEGACY_MANUAL_TARGETS];
    case "domains":
      return [];
    default:
      throw new Error(`unknown inventory category: ${category}`);
  }
}

/**
 * Canonical path for a system sidecar under its system_class subdirectory.
 * @param {string} id
 * @param {"physical"|"virtual"|string} systemClass
 */
export function manualSystemSidecarRel(id, systemClass) {
  const cls = normalizeSystemClass(systemClass);
  if (!cls) {
    throw new Error(`invalid system_class for system sidecar path: ${String(systemClass)}`);
  }
  return `${MANUAL_SYSTEMS}/${cls}/${id}.json`;
}

/**
 * Candidate canonical class-dir paths for a system id (physical then virtual).
 * @param {string} id
 * @returns {string[]}
 */
export function manualSystemSidecarClassRels(id) {
  return SYSTEM_CLASSES.map((cls) => manualSystemSidecarRel(id, cls));
}

/**
 * @param {"systems"|"services"|"networks"|"targets"|"domains"} category
 * @param {string} id filename stem
 */
export function manualSidecarRel(category, id) {
  // Systems live under systems/{physical|virtual}/; use manualSystemSidecarRel / class candidates.
  // Flat path kept only as a legacy lookup via manualSidecarLegacyRels.
  return `${manualCategoryRel(category)}/${id}.json`;
}

/**
 * Older repo-relative paths for a manual sidecar (canonical class paths excluded).
 * For systems: includes flat systems/<id>.json plus older inventory trees.
 * @param {"systems"|"services"|"networks"|"targets"|"domains"} category
 * @param {string} id
 * @returns {string[]}
 */
export function manualSidecarLegacyRels(category, id) {
  if (category === "systems") {
    return [
      `${MANUAL_SYSTEMS}/${id}.json`,
      ...manualCategoryLegacyRels(category).map((dir) => `${dir}/${id}.json`),
    ];
  }
  return manualCategoryLegacyRels(category).map((dir) => `${dir}/${id}.json`);
}

/**
 * Ordered candidate rels to find an existing system sidecar (class dirs, then legacy flat/older).
 * @param {string} id
 * @returns {string[]}
 */
export function manualSystemSidecarCandidateRels(id) {
  return [...manualSystemSidecarClassRels(id), ...manualSidecarLegacyRels("systems", id)];
}

/**
 * @param {string} systemId
 */
export function automatedSystemRel(systemId) {
  return `${AUTOMATED_SYSTEMS}/${systemId}.json`;
}

/**
 * @param {string} networkId
 */
export function automatedNetworkRel(networkId) {
  return `${AUTOMATED_NETWORKS}/${networkId}.json`;
}

/**
 * @param {string} policyId
 */
export function automatedPolicyRel(policyId) {
  return `${AUTOMATED_POLICIES}/${policyId}.json`;
}

/**
 * @param {string} domainId apex FQDN
 */
export function automatedDomainRel(domainId) {
  return `${AUTOMATED_DOMAINS}/${domainId}.json`;
}

/**
 * @param {"systems"|"networks"|"policies"|"domains"} category
 */
export function automatedCategoryRel(category) {
  switch (category) {
    case "systems":
      return AUTOMATED_SYSTEMS;
    case "networks":
      return AUTOMATED_NETWORKS;
    case "policies":
      return AUTOMATED_POLICIES;
    case "domains":
      return AUTOMATED_DOMAINS;
    default:
      throw new Error(`unknown automated inventory category: ${category}`);
  }
}

/**
 * @param {"systems"|"networks"|"policies"|"domains"} category
 * @param {string} id filename stem
 */
export function automatedSidecarRel(category, id) {
  return `${automatedCategoryRel(category)}/${id}.json`;
}
