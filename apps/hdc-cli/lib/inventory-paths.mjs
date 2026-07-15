/** Repo-relative inventory path constants (under operations/). */

export const MANUAL_SYSTEMS = "operations/manual/systems";
export const MANUAL_SERVICES = "operations/manual/services";
export const MANUAL_NETWORKS = "operations/manual/networks";
export const MANUAL_TARGETS = "operations/manual/targets";

export const AUTOMATED_SYSTEMS = "operations/automated/systems";
export const AUTOMATED_NETWORKS = "operations/automated/networks";
export const AUTOMATED_POLICIES = "operations/automated/policies";

/** @deprecated Use MANUAL_SYSTEMS */
export const LEGACY_MANUAL_SYSTEMS = "inventory/manual/systems";

/** @deprecated Use MANUAL_SERVICES */
export const LEGACY_MANUAL_SERVICES = "inventory/manual/services";

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
 * @param {"systems"|"services"|"networks"|"targets"} category
 * @param {string} id filename stem
 */
export function manualSidecarRel(category, id) {
  return `${manualCategoryRel(category)}/${id}.json`;
}

/**
 * @param {string} systemId
 */
export function automatedSystemRel(systemId) {
  return `${AUTOMATED_SYSTEMS}/${systemId}.json`;
}
