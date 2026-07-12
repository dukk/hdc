/**
 * Agent policy checks for hdc-runner web API (package + schedule allowlists).
 */

/**
 * @param {unknown} allowedPackages
 * @returns {string[]}
 */
function normalizeAllowedPackages(allowedPackages) {
  if (!Array.isArray(allowedPackages) || allowedPackages.length === 0) return [];
  return allowedPackages
    .map((entry) => {
      if (typeof entry === "string") return entry.trim().toLowerCase();
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const tier = String(/** @type {Record<string, unknown>} */ (entry).tier ?? "").trim();
        const pkg = String(/** @type {Record<string, unknown>} */ (entry).package ?? "").trim();
        if (tier && pkg) return `${tier}/${pkg}`.toLowerCase();
      }
      return "";
    })
    .filter(Boolean);
}

/**
 * @param {unknown} allowedScheduleIds
 * @returns {string[]}
 */
function normalizeAllowedScheduleIds(allowedScheduleIds) {
  if (!Array.isArray(allowedScheduleIds) || allowedScheduleIds.length === 0) return [];
  return allowedScheduleIds.map((id) => String(id).trim()).filter(Boolean);
}

/**
 * @param {{ allowed_packages?: unknown }} webConfig
 * @param {string} tier
 * @param {string} pkg
 * @returns {{ ok: true } | { ok: false; error: string }}
 */
export function validatePackagePolicy(webConfig, tier, pkg) {
  const allowed = normalizeAllowedPackages(webConfig.allowed_packages);
  if (allowed.length === 0) return { ok: true };
  const key = `${tier.trim().toLowerCase()}/${pkg.trim().toLowerCase()}`;
  if (allowed.includes(key)) return { ok: true };
  return { ok: false, error: `package not allowed: ${tier}/${pkg}` };
}

/**
 * @param {{ allowed_schedule_ids?: unknown }} webConfig
 * @param {string} scheduleId
 * @returns {{ ok: true } | { ok: false; error: string }}
 */
export function validateSchedulePolicy(webConfig, scheduleId) {
  const allowed = normalizeAllowedScheduleIds(webConfig.allowed_schedule_ids);
  if (allowed.length === 0) return { ok: true };
  if (allowed.includes(scheduleId.trim())) return { ok: true };
  return { ok: false, error: `schedule not allowed: ${scheduleId}` };
}

export { normalizeAllowedPackages, normalizeAllowedScheduleIds };
