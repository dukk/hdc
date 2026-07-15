/**
 * Poll until apt/dpkg locks are free (e.g. unattended-upgrades finished).
 */

/** Default wait before giving up (15 minutes). */
export const DEFAULT_APT_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

/** Poll interval between lock probes. */
export const DEFAULT_APT_LOCK_POLL_MS = 5_000;

/**
 * Remote shell: exit 0 when no process holds common apt/dpkg locks.
 * @returns {string}
 */
export function aptLockProbeCommand() {
  return [
    "! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1",
    "! fuser /var/lib/apt/lists/lock >/dev/null 2>&1",
  ].join(" && ");
}

/**
 * @param {import("./clamav-ensure.mjs").ConfigureExec} exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} log
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.pollMs]
 * @returns {Promise<{ ok: true } | { ok: false; message: string }>}
 */
export async function waitForAptLock(exec, log, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_APT_LOCK_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_APT_LOCK_POLL_MS;
  const probe = aptLockProbeCommand();
  const deadline = Date.now() + timeoutMs;
  let waited = false;

  while (Date.now() < deadline) {
    const r = exec.run(probe, { capture: true });
    if (r.status === 0) {
      if (waited) {
        log.info(`${exec.label}: apt/dpkg lock released`);
      }
      return { ok: true };
    }
    waited = true;
    log.info(`${exec.label}: waiting for apt/dpkg lock…`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const message = `apt lock timeout after ${Math.round(timeoutMs / 1000)}s`;
  if (log.warn) log.warn(`${exec.label}: ${message}`);
  return { ok: false, message };
}
