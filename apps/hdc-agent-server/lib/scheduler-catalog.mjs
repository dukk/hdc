/**
 * Normalize hdc_agents.schedules[] (migrated from hdc-runner).
 */

/**
 * @param {unknown} raw
 * @returns {Array<Record<string, unknown>>}
 */
export function normalizeSchedules(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (item);
    if (o.enabled === false) continue;
    if (String(o.type ?? "cli").trim() === "agent") continue; // Cursor fallback retired
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const cron = typeof o.cron === "string" ? o.cron.trim() : "";
    if (!id || !cron) continue;
    const cli = Array.isArray(o.cli) ? o.cli.map(String) : [];
    if (!cli.length) continue;
    out.push({
      id,
      cron,
      cli,
      cli_args: Array.isArray(o.cli_args) ? o.cli_args.map(String) : [],
      mail: o.mail && typeof o.mail === "object" ? o.mail : {},
      discord: o.discord && typeof o.discord === "object" ? o.discord : {},
      enabled: true,
    });
  }
  return out;
}

/**
 * Default schedules when config omits schedules[].
 */
export function defaultSchedules() {
  return [
    {
      id: "daily-maintain",
      cron: "0 3 * * *",
      cli: ["maintain", "daily"],
      cli_args: ["--skip-clients"],
      mail: { enabled: true, on_failure_only: false },
      discord: { enabled: true, on_failure_only: false },
    },
    {
      id: "hdc-ops-daily",
      cron: "15 3 * * *",
      cli: ["run-daily"],
      cli_args: [],
      discord: { enabled: true, on_failure_only: false },
    },
    {
      id: "bind-maintain-weekly",
      cron: "30 4 * * 0",
      cli: ["run", "service", "bind", "maintain"],
      cli_args: ["--no-reboot", "--skip-resources"],
    },
  ];
}

/**
 * @param {Record<string, unknown>} hdcAgents
 */
export function schedulesFromConfig(hdcAgents) {
  const list = normalizeSchedules(hdcAgents.schedules);
  return list.length ? list : normalizeSchedules(defaultSchedules());
}

/**
 * Minimal 5-field cron match (minute hour dom month dow).
 * Supports star, N, slash-steps, ranges, and lists.
 * @param {string} expr
 * @param {Date} [now]
 */
export function cronMatches(expr, now = new Date()) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const vals = [
    now.getUTCMinutes(),
    now.getUTCHours(),
    now.getUTCDate(),
    now.getUTCMonth() + 1,
    now.getUTCDay(),
  ];
  for (let i = 0; i < 5; i++) {
    if (!fieldMatches(parts[i], vals[i], i === 4 ? 6 : i === 3 ? 12 : i === 2 ? 31 : i === 1 ? 23 : 59)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {string} field
 * @param {number} value
 * @param {number} max
 */
function fieldMatches(field, value, max) {
  const f = String(field).trim();
  if (f === "*") return true;
  for (const piece of f.split(",")) {
    const p = piece.trim();
    if (p.startsWith("*/")) {
      const step = Number(p.slice(2));
      if (Number.isFinite(step) && step > 0 && value % step === 0) return true;
      continue;
    }
    const range = p.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (value >= a && value <= b) return true;
      continue;
    }
    if (Number(p) === value) return true;
  }
  void max;
  return false;
}
