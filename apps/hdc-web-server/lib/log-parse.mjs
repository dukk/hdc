/**
 * Parse scheduled job log markers.
 *
 * @param {string} text
 * @returns {{ started_at: string | null; finished_at: string | null; exit_code: number | null }[]}
 */
export function parseScheduleLogRuns(text) {
  const runs = /** @type {{ started_at: string | null; finished_at: string | null; exit_code: number | null }[]} */ (
    []
  );
  if (!text) return runs;

  /** @type {{ started_at: string | null; finished_at: string | null; exit_code: number | null }} */
  let current = { started_at: null, finished_at: null, exit_code: null };

  for (const line of text.split(/\r?\n/)) {
    const startMatch = line.match(/^=== ([0-9T:.+-]+Z?) job .+ started ===$/);
    if (startMatch) {
      if (current.started_at || current.finished_at) {
        runs.push(current);
      }
      current = { started_at: startMatch[1], finished_at: null, exit_code: null };
      continue;
    }
    const endMatch = line.match(/^--- ([0-9T:.+-]+Z?) exit=(-?\d+) ---$/);
    if (endMatch) {
      current.finished_at = endMatch[1];
      current.exit_code = Number(endMatch[2]);
      runs.push(current);
      current = { started_at: null, finished_at: null, exit_code: null };
    }
  }

  if (current.started_at || current.finished_at) {
    runs.push(current);
  }

  return runs;
}

/**
 * @param {string} text
 * @returns {{ last_run_iso: string | null; last_exit_code: number | null }}
 */
export function lastScheduleLogRun(text) {
  const runs = parseScheduleLogRuns(text);
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (run.finished_at !== null && run.exit_code !== null) {
      return { last_run_iso: run.finished_at, last_exit_code: run.exit_code };
    }
  }
  return { last_run_iso: null, last_exit_code: null };
}

/** @param {string} id */
export function sanitizeScheduleId(id) {
  const s = String(id ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(s)) {
    throw new Error(`invalid schedule id ${JSON.stringify(id)} (use lowercase letters, digits, hyphen)`);
  }
  return s;
}
