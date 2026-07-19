import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function defaultDailyMaintainLockPath(env = process.env) {
  const override = typeof env.HDC_DAILY_MAINTAIN_LOCK === "string" ? env.HDC_DAILY_MAINTAIN_LOCK.trim() : "";
  if (override) return override;
  return join(homedir(), ".hdc", "locks", "daily-maintain.lock");
}

/**
 * @param {string} lockPath
 * @returns {{ pid: number; startedAt: string } | null}
 */
export function readDailyMaintainLock(lockPath) {
  try {
    const raw = JSON.parse(readFileSync(lockPath, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const pid = Number(raw.pid);
    const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : "";
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, startedAt };
  } catch {
    return null;
  }
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err.code === "EPERM") return true;
    return false;
  }
}

/**
 * Acquire an exclusive lock for daily maintain. Stale locks (dead pid) are replaced.
 *
 * @param {object} [opts]
 * @param {string} [opts.lockPath]
 * @param {number} [opts.pid]
 * @param {() => string} [opts.nowIso]
 * @returns {{ ok: true; lockPath: string; created: boolean } | { ok: false; lockPath: string; holder: { pid: number; startedAt: string } }}
 */
export function acquireDailyMaintainLock(opts = {}) {
  const lockPath = opts.lockPath ?? defaultDailyMaintainLockPath();
  const pid = opts.pid ?? process.pid;
  const nowIso = opts.nowIso ?? (() => new Date().toISOString());
  mkdirSync(dirname(lockPath), { recursive: true });

  const existing = readDailyMaintainLock(lockPath);
  if (existing && existing.pid !== pid && processExists(existing.pid)) {
    return { ok: false, lockPath, holder: existing };
  }

  const payload = `${JSON.stringify({ pid, startedAt: nowIso() }, null, 2)}\n`;

  try {
    const fd = openSync(lockPath, "wx");
    try {
      writeFileSync(fd, payload, "utf8");
    } finally {
      closeSync(fd);
    }
    return { ok: true, lockPath, created: true };
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err.code !== "EEXIST") throw e;
    const again = readDailyMaintainLock(lockPath);
    if (again && processExists(again.pid) && again.pid !== pid) {
      return { ok: false, lockPath, holder: again };
    }
    writeFileSync(lockPath, payload, "utf8");
    return { ok: true, lockPath, created: true };
  }
}

/**
 * @param {string} lockPath
 * @param {number} [pid]
 */
export function releaseDailyMaintainLock(lockPath, pid = process.pid) {
  const existing = readDailyMaintainLock(lockPath);
  if (!existing) return;
  if (existing.pid !== pid) return;
  try {
    unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

/**
 * Default per-step timeout for daily maintain child processes (ms).
 * Override: HDC_DAILY_STEP_TIMEOUT_MS or --step-timeout-ms.
 */
export const DAILY_STEP_DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * @param {{ stepTimeoutMs?: number } | undefined} flags
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveDailyStepTimeoutMs(flags, env = process.env) {
  const fromFlags = Number(flags?.stepTimeoutMs);
  if (Number.isFinite(fromFlags) && fromFlags > 0) return Math.round(fromFlags);
  const fromEnv = Number(env.HDC_DAILY_STEP_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.round(fromEnv);
  return DAILY_STEP_DEFAULT_TIMEOUT_MS;
}
