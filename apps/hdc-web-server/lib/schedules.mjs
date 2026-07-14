import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { sanitizeScheduleId, lastScheduleLogRun, parseScheduleLogRuns } from "./log-parse.mjs";

const MAX_LOG_BYTES = 512 * 1024;

/**
 * @param {string} metaRoot
 */
export function loadSchedulesFile(metaRoot) {
  const path = join(metaRoot, "schedules.json");
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(raw.schedules) ? raw.schedules : [];
}

/**
 * @param {string} logDir
 * @param {string} scheduleId
 */
export function scheduleLogPath(logDir, scheduleId) {
  return join(logDir, `${sanitizeScheduleId(scheduleId)}.log`);
}

/**
 * @param {string} metaRoot
 * @param {string} logDir
 */
export function listSchedulesWithStatus(metaRoot, logDir) {
  const schedules = loadSchedulesFile(metaRoot);
  return schedules.map((s) => {
    const id = sanitizeScheduleId(String(s?.id ?? ""));
    const logPath = scheduleLogPath(logDir, id);
    /** @type {Record<string, unknown>} */
    const row = {
      id,
      cron: s.cron ?? null,
      cli: s.cli ?? [],
      cli_args: s.cli_args ?? [],
      log_path: logPath,
      log_bytes: 0,
      last_run_iso: null,
      last_exit_code: null,
    };
    if (existsSync(logPath)) {
      try {
        const st = statSync(logPath);
        row.log_bytes = st.size;
        const text = readFileSync(logPath, "utf8");
        const last = lastScheduleLogRun(text);
        row.last_run_iso = last.last_run_iso;
        row.last_exit_code = last.last_exit_code;
      } catch {
        /* ignore */
      }
    }
    return row;
  });
}

/**
 * @param {string} logDir
 * @param {string} scheduleId
 * @param {{ offset?: number; limit?: number; parsed?: boolean }} [opts]
 */
export function readScheduleLog(logDir, scheduleId, opts = {}) {
  const id = sanitizeScheduleId(scheduleId);
  const logPath = scheduleLogPath(logDir, id);
  if (!existsSync(logPath)) {
    return { id, text: "", runs: [], log_bytes: 0 };
  }
  const st = statSync(logPath);
  const full = readFileSync(logPath, "utf8");
  if (opts.parsed) {
    return { id, text: null, runs: parseScheduleLogRuns(full), log_bytes: st.size };
  }
  const offset = Math.max(0, Number(opts.offset) || 0);
  const limit = Math.min(MAX_LOG_BYTES, Math.max(1, Number(opts.limit) || MAX_LOG_BYTES));
  const slice = full.slice(offset, offset + limit);
  return {
    id,
    text: slice,
    offset,
    total_bytes: st.size,
    truncated: offset + slice.length < st.size,
    log_bytes: st.size,
  };
}

/**
 * @param {string} scheduleId
 * @param {unknown[]} schedules
 */
export function scheduleExists(scheduleId, schedules) {
  const id = sanitizeScheduleId(scheduleId);
  return schedules.some((s) => {
    const row = /** @type {{ id?: string }} */ (s);
    return sanitizeScheduleId(String(row?.id ?? "")) === id;
  });
}

/**
 * @param {string} logDir
 */
export function ensureLogDir(logDir) {
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  return logDir;
}

export { MAX_LOG_BYTES };
