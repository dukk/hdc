/**
 * Roll up hdc-scheduler job logs into a daily Discord/Slack summary.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const START_RE = /^=== (\d{4}-\d{2}-\d{2}T[\d:.]+Z) job (\S+) started ===$/gm;
const EXIT_RE = /^--- (\d{4}-\d{2}-\d{2}T[\d:.]+Z) exit=(-?\d+) ---$/gm;

/**
 * @typedef {object} ScheduleRun
 * @property {string} startedAt
 * @property {string} [finishedAt]
 * @property {number | null} exitCode
 */

/**
 * @typedef {object} ScheduleJobStats
 * @property {string} id
 * @property {string} cron
 * @property {number} runs
 * @property {number} ok
 * @property {number} fail
 * @property {number | null} lastExit
 * @property {string | null} lastFinishedAt
 */

/**
 * Parse one scheduler log into completed runs (start paired with following exit).
 * @param {string} text
 * @param {string} [scheduleId]
 * @returns {ScheduleRun[]}
 */
export function parseScheduleLogRuns(text, scheduleId = "") {
  /** @type {{ kind: "start" | "exit", at: string, exitCode?: number }[]} */
  const events = [];
  for (const m of String(text).matchAll(START_RE)) {
    events.push({ kind: "start", at: m[1] });
  }
  for (const m of String(text).matchAll(EXIT_RE)) {
    events.push({ kind: "exit", at: m[1], exitCode: Number(m[2]) });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));

  /** @type {ScheduleRun[]} */
  const runs = [];
  /** @type {ScheduleRun | null} */
  let open = null;
  for (const ev of events) {
    if (ev.kind === "start") {
      open = { startedAt: ev.at, exitCode: null };
      runs.push(open);
    } else if (ev.kind === "exit") {
      if (open && open.exitCode == null) {
        open.finishedAt = ev.at;
        open.exitCode = Number.isFinite(ev.exitCode) ? /** @type {number} */ (ev.exitCode) : null;
        open = null;
      } else {
        // Orphan exit (missing start line) — still count as a run.
        runs.push({
          startedAt: ev.at,
          finishedAt: ev.at,
          exitCode: Number.isFinite(ev.exitCode) ? /** @type {number} */ (ev.exitCode) : null,
        });
      }
    }
  }
  void scheduleId;
  return runs;
}

/**
 * @param {ScheduleRun[]} runs
 * @param {number} sinceMs
 * @param {number} [untilMs]
 */
export function filterRunsInWindow(runs, sinceMs, untilMs = Date.now()) {
  return runs.filter((r) => {
    const t = Date.parse(r.finishedAt || r.startedAt);
    if (!Number.isFinite(t)) return false;
    return t >= sinceMs && t <= untilMs;
  });
}

/**
 * @param {object} opts
 * @param {string} opts.logDir
 * @param {Array<{ id: string, cron?: string }>} opts.schedules
 * @param {number} [opts.windowMs]
 * @param {number} [opts.nowMs]
 * @param {string[]} [opts.excludeIds] schedule ids to omit (e.g. schedule-summary itself)
 * @returns {ScheduleJobStats[]}
 */
export function collectScheduleStats(opts) {
  const windowMs = opts.windowMs ?? 24 * 60 * 60 * 1000;
  const nowMs = opts.nowMs ?? Date.now();
  const sinceMs = nowMs - windowMs;
  const exclude = new Set((opts.excludeIds ?? []).map(String));
  const logDir = opts.logDir;

  /** @type {Map<string, string>} */
  const cronById = new Map();
  for (const s of opts.schedules) {
    if (!s?.id) continue;
    cronById.set(String(s.id), typeof s.cron === "string" ? s.cron : "");
  }

  /** @type {Set<string>} */
  const ids = new Set([...cronById.keys()]);
  if (existsSync(logDir)) {
    for (const name of readdirSync(logDir)) {
      if (!name.endsWith(".log")) continue;
      ids.add(name.slice(0, -4));
    }
  }

  /** @type {ScheduleJobStats[]} */
  const out = [];
  for (const id of [...ids].sort()) {
    if (exclude.has(id)) continue;
    const logPath = join(logDir, `${id}.log`);
    const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    const windowRuns = filterRunsInWindow(parseScheduleLogRuns(text, id), sinceMs, nowMs);
    let ok = 0;
    let fail = 0;
    /** @type {number | null} */
    let lastExit = null;
    /** @type {string | null} */
    let lastFinishedAt = null;
    for (const r of windowRuns) {
      if (r.exitCode === 0) ok += 1;
      else if (r.exitCode != null) fail += 1;
      if (r.finishedAt && (!lastFinishedAt || r.finishedAt > lastFinishedAt)) {
        lastFinishedAt = r.finishedAt;
        lastExit = r.exitCode;
      }
    }
    out.push({
      id,
      cron: cronById.get(id) || "(unknown)",
      runs: windowRuns.length,
      ok,
      fail,
      lastExit,
      lastFinishedAt,
    });
  }
  return out;
}

/**
 * Load schedules list from meta schedules.json.
 * @param {string} metaRoot
 * @returns {Array<{ id: string, cron?: string }>}
 */
export function loadSchedulesFromMeta(metaRoot) {
  const path = join(metaRoot, "schedules.json");
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const list = Array.isArray(raw?.schedules) ? raw.schedules : Array.isArray(raw) ? raw : [];
    return list
      .filter((s) => s && typeof s === "object" && typeof s.id === "string")
      .map((s) => ({
        id: String(s.id),
        cron: typeof s.cron === "string" ? s.cron : "",
      }));
  } catch {
    return [];
  }
}

/**
 * @param {ScheduleJobStats[]} stats
 * @param {{ windowHours?: number }} [opts]
 * @returns {{ title: string, message: string, allOk: boolean, totalRuns: number, totalFail: number }}
 */
export function formatScheduleSummaryMessage(stats, opts = {}) {
  const hours = opts.windowHours ?? 24;
  const totalRuns = stats.reduce((n, s) => n + s.runs, 0);
  const totalFail = stats.reduce((n, s) => n + s.fail, 0);
  const allOk = totalFail === 0;
  const lines = [`Schedule summary (${hours}h)`, ""];
  const withActivity = stats.filter((s) => s.runs > 0 || s.cron !== "(unknown)");
  for (const s of withActivity) {
    const last =
      s.lastExit == null ? "last —" : `last exit=${s.lastExit}`;
    lines.push(
      `${s.id}  cron ${s.cron}  runs ${s.runs}  ok ${s.ok}  fail ${s.fail}  ${last}`,
    );
  }
  if (!withActivity.length) {
    lines.push("(no scheduled jobs configured)");
  }
  lines.push("");
  lines.push(allOk ? "All scheduled jobs OK" : `Failures in window: ${totalFail}`);
  return {
    title: "[HDC] schedule-summary",
    message: lines.join("\n"),
    allOk,
    totalRuns,
    totalFail,
  };
}

/**
 * Build summary from meta root (logs + schedules.json).
 * @param {object} opts
 * @param {string} opts.metaRoot
 * @param {string} [opts.logDir]
 * @param {number} [opts.windowMs]
 * @param {number} [opts.nowMs]
 * @param {string} [opts.titlePrefix]
 */
export function buildScheduleSummary(opts) {
  const metaRoot = opts.metaRoot;
  const logDir = opts.logDir || join(metaRoot, "logs");
  const schedules = loadSchedulesFromMeta(metaRoot);
  const stats = collectScheduleStats({
    logDir,
    schedules,
    windowMs: opts.windowMs,
    nowMs: opts.nowMs,
    excludeIds: ["schedule-summary"],
  });
  const windowHours = Math.round((opts.windowMs ?? 24 * 60 * 60 * 1000) / (60 * 60 * 1000));
  const formatted = formatScheduleSummaryMessage(stats, { windowHours });
  const prefix = String(opts.titlePrefix || "[HDC]").trim() || "[HDC]";
  return {
    ...formatted,
    title: `${prefix} schedule-summary`,
    stats,
  };
}
