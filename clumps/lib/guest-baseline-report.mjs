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
  existing.guest_startup = baseline.guest_startup;
  existing.guest_tags = baseline.guest_tags;
  existing.hdc_user = baseline.hdc_user;
  existing.admin_user = baseline.admin_user;
  existing.clamav = baseline.clamav;
  existing.clamav_scan_schedule = baseline.clamav_scan_schedule;
  existing.unattended_upgrades = baseline.unattended_upgrades;
  existing.mail_relay = baseline.mail_relay;
  existing.crowdsec_agent = baseline.crowdsec_agent;
  existing.wazuh_agent = baseline.wazuh_agent;
  if (baseline.wazuh_log_collection) {
    existing.wazuh_log_collection = baseline.wazuh_log_collection;
  }
  existing.root_login_disabled = baseline.root_login_disabled;
  if (!guestBaselineUsersOk(baseline)) {
    existing.ok = false;
  }
  for (const key of [
    "mail_relay",
    "clamav",
    "clamav_scan_schedule",
    "unattended_upgrades",
    "crowdsec_agent",
    "wazuh_agent",
    "wazuh_log_collection",
  ]) {
    const block = baseline[key];
    if (isResultRow(block) && block.skipped !== true && block.ok === false) {
      existing.ok = false;
    }
  }
}

/**
 * @param {unknown} baseline
 * @returns {boolean}
 */
export function guestBaselineUsersOk(baseline) {
  if (!isResultRow(baseline)) return true;
  const b = /** @type {Record<string, unknown>} */ (baseline);
  for (const key of ["hdc_user", "admin_user", "root_login_disabled"]) {
    const block = b[key];
    if (!isResultRow(block)) continue;
    const row = /** @type {Record<string, unknown>} */ (block);
    if (row.skipped === true) continue;
    if (row.ok === false) return false;
  }
  return true;
}

/**
 * Fields to copy from ensureGuestLinuxBaseline result into maintain JSON rows.
 * @param {Record<string, unknown>} baseline
 */
export function guestBaselineResultFields(baseline) {
  return {
    guest_resources: baseline.guest_resources,
    guest_startup: baseline.guest_startup,
    guest_tags: baseline.guest_tags,
    hdc_user: baseline.hdc_user,
    admin_user: baseline.admin_user,
    clamav: baseline.clamav,
    clamav_scan_schedule: baseline.clamav_scan_schedule,
    unattended_upgrades: baseline.unattended_upgrades,
    mail_relay: baseline.mail_relay,
    crowdsec_agent: baseline.crowdsec_agent,
    wazuh_agent: baseline.wazuh_agent,
    root_login_disabled: baseline.root_login_disabled,
  };
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
    if (
      !row.admin_user &&
      !row.clamav &&
      !row.clamav_scan_schedule &&
      !row.unattended_upgrades &&
      !row.hdc_user &&
      !row.root_login_disabled &&
      !row.mail_relay &&
      !row.crowdsec_agent &&
      !row.wazuh_agent &&
      !row.wazuh_log_collection
    )
      continue;
    bySystem.set(sid, row);
  }

  if (!bySystem.size) {
    lines.push("_No guest baseline results in payload._", "");
    return lines;
  }

  for (const [sid, row] of bySystem) {
    const role = typeof row.role === "string" ? ` (${row.role})` : "";
    lines.push(`### ${sid}${role}`, "");
    if (row.hdc_user) {
      lines.push(`- **hdc_user:** ${formatGuestBaselineBlock(row.hdc_user)}`);
    }
    if (row.admin_user) {
      lines.push(`- **admin_user:** ${formatGuestBaselineBlock(row.admin_user)}`);
    }
    if (row.clamav) {
      lines.push(`- **clamav:** ${formatGuestBaselineBlock(row.clamav)}`);
    }
    if (row.clamav_scan_schedule) {
      lines.push(`- **clamav_scan_schedule:** ${formatGuestBaselineBlock(row.clamav_scan_schedule)}`);
    }
    if (row.unattended_upgrades) {
      lines.push(`- **unattended_upgrades:** ${formatGuestBaselineBlock(row.unattended_upgrades)}`);
    }
    if (row.crowdsec_agent) {
      lines.push(`- **crowdsec_agent:** ${formatGuestBaselineBlock(row.crowdsec_agent)}`);
    }
    if (row.wazuh_agent) {
      lines.push(`- **wazuh_agent:** ${formatGuestBaselineBlock(row.wazuh_agent)}`);
    }
    if (row.wazuh_log_collection) {
      lines.push(`- **wazuh_log_collection:** ${formatGuestBaselineBlock(row.wazuh_log_collection)}`);
    }
    if (row.mail_relay) {
      lines.push(`- **mail_relay:** ${formatGuestBaselineBlock(row.mail_relay)}`);
    }
    if (row.root_login_disabled) {
      lines.push(`- **root_login_disabled:** ${formatGuestBaselineBlock(row.root_login_disabled)}`);
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
    return Boolean(
      payload?.admin_user ||
        payload?.clamav ||
        payload?.clamav_scan_schedule ||
        payload?.unattended_upgrades ||
        payload?.hdc_user ||
        payload?.root_login_disabled ||
        payload?.mail_relay ||
        payload?.crowdsec_agent ||
        payload?.wazuh_agent ||
        payload?.wazuh_log_collection,
    );
  }
  return rawResults.some((r) => {
    if (!isResultRow(r)) return false;
    const row = /** @type {Record<string, unknown>} */ (r);
    return Boolean(
      row.admin_user ||
        row.clamav ||
        row.clamav_scan_schedule ||
        row.unattended_upgrades ||
        row.hdc_user ||
        row.root_login_disabled ||
        row.mail_relay ||
        row.crowdsec_agent ||
        row.wazuh_agent ||
        row.wazuh_log_collection,
    );
  });
}
