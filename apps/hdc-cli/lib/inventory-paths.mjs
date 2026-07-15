/** Repo-relative inventory path constants (under operations/). */

export const MANUAL_SYSTEMS = "operations/inventory/systems";
export const MANUAL_SERVICES = "operations/inventory/services";
export const MANUAL_NETWORKS = "operations/inventory/networks";
export const MANUAL_TARGETS = "operations/inventory/targets";

export const AUTOMATED_SYSTEMS = "operations/automated/systems";
export const AUTOMATED_NETWORKS = "operations/automated/networks";
export const AUTOMATED_POLICIES = "operations/automated/policies";

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
 * Resolve a manual inventory category path with legacy fallback.
 * @param {string} category systems | services | networks | targets
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
    default:
      throw new Error(`unknown inventory category: ${category}`);
  }
}

/**
 * Legacy category dirs to scan when canonical path is missing.
 * @param {"systems"|"services"|"networks"|"targets"} category
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
    default:
      throw new Error(`unknown inventory category: ${category}`);
  }
}

/**
 * @param {"systems"|"services"|"networks"|"targets"} category
 * @param {string} id filename stem
 */
export function manualSidecarRel(category, id) {
  return `${manualCategoryRel(category)}/${id}.json`;
}

/**
 * Older repo-relative paths for a manual sidecar (canonical path excluded).
 * @param {"systems"|"services"|"networks"|"targets"} category
 * @param {string} id
 * @returns {string[]}
 */
export function manualSidecarLegacyRels(category, id) {
  return manualCategoryLegacyRels(category).map((dir) => `${dir}/${id}.json`);
}

/**
 * @param {string} systemId
 */
export function automatedSystemRel(systemId) {
  return `${AUTOMATED_SYSTEMS}/${systemId}.json`;
}
