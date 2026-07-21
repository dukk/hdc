/**
 * Optional container-native schedule: set HDC_AGENT_SCHEDULE_MINUTES (>0) to
 * periodically run the scripted dispatcher (LLM only when work is detected).
 *
 * Defaults by role when env unset:
 * - hdc-manager: 15
 * - hdc-monitor: 60
 * - hdc-maintainer: 1440 (daily)
 * - hdc-security-expert: 120
 * - hdc-research: 10080 (7d)
 * - others: disabled (0) — A2A on-demand only
 */
export function defaultScheduleMinutes(role) {
  switch (role) {
    case "hdc-manager":
      return 15;
    case "hdc-monitor":
      return 60;
    case "hdc-maintainer":
      return 1440;
    case "hdc-security-expert":
      return 120;
    case "hdc-research":
      return 10080;
    default:
      return 0;
  }
}

/**
 * @param {string} role
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveScheduleMinutes(role, env = process.env) {
  const raw = String(env.HDC_AGENT_SCHEDULE_MINUTES ?? "").trim();
  if (raw === "0" || raw.toLowerCase() === "off") return 0;
  if (raw) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return defaultScheduleMinutes(role);
}

/**
 * @param {object} opts
 * @param {string} opts.role
 * @param {() => Promise<void>} opts.runSweep
 * @param {(line: string) => void} [opts.log]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {(() => void) | null} cancel function
 */
export function startScheduleLoop(opts) {
  const minutes = resolveScheduleMinutes(opts.role, opts.env);
  if (!minutes) return null;
  const ms = minutes * 60 * 1000;
  const log = opts.log ?? ((line) => process.stderr.write(`${line}\n`));
  log(`[hdc-agent-server] schedule: every ${minutes}m for ${opts.role} (scripted dispatcher)`);

  let running = false;
  const tick = async () => {
    if (running) {
      log(`[hdc-agent-server] schedule: skip (previous sweep still running)`);
      return;
    }
    running = true;
    try {
      await opts.runSweep();
    } catch (e) {
      log(`[hdc-agent-server] schedule error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };

  // First tick after one interval (avoid thundering herd at container start).
  const handle = setInterval(() => {
    void tick();
  }, ms);
  if (typeof handle.unref === "function") handle.unref();

  return () => clearInterval(handle);
}
