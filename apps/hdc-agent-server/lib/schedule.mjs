/**
 * Optional container-native schedule: set HDC_AGENT_SCHEDULE_MINUTES (>0) to
 * periodically enqueue a sweep message on the local A2A task queue.
 *
 * Defaults by role when env unset:
 * - hdc-monitor: 240 (4h)
 * - hdc-security-expert: 360 (6h)
 * - hdc-research: 10080 (7d)
 * - others: disabled (0)
 */
export function defaultScheduleMinutes(role) {
  switch (role) {
    case "hdc-monitor":
      return 240;
    case "hdc-security-expert":
      return 360;
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
 * @param {() => Promise<string>} opts.runSweep
 * @param {(line: string) => void} [opts.log]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {(() => void) | null} cancel function
 */
export function startScheduleLoop(opts) {
  const minutes = resolveScheduleMinutes(opts.role, opts.env);
  if (!minutes) return null;
  const ms = minutes * 60 * 1000;
  const log = opts.log ?? ((line) => process.stderr.write(`${line}\n`));
  log(`[hdc-agent-server] schedule: every ${minutes}m for ${opts.role}`);

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

/**
 * @param {string} role
 */
export function defaultSweepPrompt(role) {
  return (
    `Scheduled ${role} sweep. Follow your agent definition and hdc-agent-team skill. ` +
    `Use query-only tools unless policy allows maintain. Write digests/tasks under operations/ as appropriate.`
  );
}
