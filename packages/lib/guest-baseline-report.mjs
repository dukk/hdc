/**
 * Shared helpers for guest Linux baseline (admin user + ClamAV) in maintain payloads and reports.
 */

/** @param {unknown} row */
function isResultRow(row) {
  return row !== null && typeof row === "object" && !Array.isArray(row);
}

/**
 * @param {unknown} block
 * @returns {string}
 */
export function formatGuestBaselineBlock(block) {
  if (!isResultRow(block)) return "unknown";
  const b = /** @type {Record<string, unknown>} */ (block);
  if (b.skipped === true) return "skipped";
  if (b.ok === true) {
    const username = typeof b.username === "string" ? b.username : "";
    const message = typeof b.message === "string" ? b.message : "ok";
    return username ? `${username} — ${message}` : message;
  }
  if (b.ok === false) {
    return typeof b.message === "string" ? b.message : "failed";
  }
  return "unknown";
}

/**
 * @param {unknown} baseline
 * @returns {boolean}
 */
export function adminUserOkFromBaseline(baseline) {
  if (!isResultRow(baseline)) return true;
  const b = /** @type {Record<string, unknown>} */ (baseline);
  const admin = b.admin_user;
  if (!isResultRow(admin)) return true;
  const a = /** @type {Record<string, unknown>} */ (admin);
  if (a.skipped === true) return true;
  return a.ok !== false;
}

/**
 * Merge guest baseline fields onto an existing maintain result row.
 *
 * @param {Record<string, unknown>} existing
 * @param {Record<string, unknown>} baseline
 */
export function mergeGuestBaselineIntoResult(existing, baseline) {
  existing.guest_resources = baseline.guest_resources;
  existing.admin_user = baseline.admin_user;
  existing.clamav = baseline.clamav;
  if (!adminUserOkFromBaseline(baseline)) {
    existing.ok = false;
  }
}

/**
 * @param {import("./operation-report.mjs").OperationReportContext} ctx
 * @returns {string[]}
 */
export function guestBaselineReportExtraSections(ctx) {
  const lines = ["## Guest baseline", ""];
  const payload = ctx.stdoutPayload;
  const rawResults = payload?.results ?? payload?.instances;
  if (!Array.isArray(rawResults) || !rawResults.length) {
    lines.push("_No baseline results in payload._", "");
    return lines;
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const bySystem = new Map();
  for (const r of rawResults) {
    if (!isResultRow(r)) continue;
    const row = /** @type {Record<string, unknown>} */ (r);
    const sid = row.system_id ?? row.systemId;
    if (typeof sid !== "string") continue;
    if (!row.admin_user && !row.clamav) continue;
    bySystem.set(sid, row);
  }

  if (!bySystem.size) {
    lines.push("_No guest baseline results in payload._", "");
    return lines;
  }

  for (const [sid, row] of bySystem) {
    const role = typeof row.role === "string" ? ` (${row.role})` : "";
    lines.push(`### ${sid}${role}`, "");
    if (row.admin_user) {
      lines.push(`- **admin_user:** ${formatGuestBaselineBlock(row.admin_user)}`);
    }
    if (row.clamav) {
      lines.push(`- **clamav:** ${formatGuestBaselineBlock(row.clamav)}`);
    }
    lines.push("");
  }

  return lines;
}

/**
 * @param {import("./operation-report.mjs").OperationReportContext} ctx
 * @returns {boolean}
 */
export function payloadHasGuestBaseline(ctx) {
  const payload = ctx.stdoutPayload;
  const rawResults = payload?.results ?? payload?.instances;
  if (!Array.isArray(rawResults)) {
    return Boolean(payload?.admin_user || payload?.clamav);
  }
  return rawResults.some((r) => {
    if (!isResultRow(r)) return false;
    const row = /** @type {Record<string, unknown>} */ (r);
    return Boolean(row.admin_user || row.clamav);
  });
}
