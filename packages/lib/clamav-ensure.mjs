import { flagGet } from "./parse-argv-flags.mjs";
import { waitForAptLock } from "./apt-lock-wait.mjs";
import {
  clamavAptInstallCommandForProfile,
  clamavConfigApplyCommandForProfile,
  clamavDaemonInstalledCheckCommand,
  clamavDaemonPackageInstallCommand,
  clamavEnableServicesCommandForProfile,
  resolveClamavProfile,
} from "./clamav-resource-profile.mjs";

/**
 * @typedef {import("./clamav-resource-profile.mjs").ClamavProfile} ClamavProfile
 */

/**
 * @typedef {object} ConfigureExec
 * @property {(inner: string, opts?: { capture?: boolean }) => { status: number; stdout: string; stderr: string }} run
 * @property {string} label Safe description for logs (no secrets).
 */

/**
 * @typedef {object} ClamavEnsureResult
 * @property {boolean} ok
 * @property {boolean} skipped
 * @property {string} message
 * @property {ClamavProfile} [profile]
 * @property {number} [memory_mb]
 */

/** @returns {string} */
export function clamavInstalledCheckCommand() {
  return "dpkg -s clamav >/dev/null 2>&1";
}

/**
 * @param {ClamavProfile} [profile]
 * @returns {string}
 */
export function clamavAptInstallCommand(profile = "full") {
  return clamavAptInstallCommandForProfile(profile);
}

/**
 * @param {ClamavProfile} [profile]
 * @returns {string}
 */
export function clamavEnableServicesCommand(profile = "full") {
  return clamavEnableServicesCommandForProfile(profile);
}

/**
 * @param {Record<string, string>} [flags]
 * @returns {boolean}
 */
export function clamavSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-clamav", "skip_clamav") !== undefined;
}

/**
 * @param {ConfigureExec} exec
 * @param {string} cmd
 * @param {{ info: (msg: string) => void }} log
 */
function runChecked(exec, cmd, log) {
  const preview = cmd.split("\n")[0].slice(0, 100);
  log.info(`${exec.label}: ${preview}`);
  const r = exec.run(cmd, { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    throw new Error(detail);
  }
  return r;
}

/**
 * @param {ConfigureExec} exec
 * @param {ClamavProfile} profile
 * @param {{ info: (msg: string) => void }} log
 */
async function ensureClamavDaemonPackage(exec, profile, log) {
  if (profile === "lean") return;
  const check = exec.run(clamavDaemonInstalledCheckCommand(), { capture: true });
  if (check.status === 0) return;

  const lock = await waitForAptLock(exec, log);
  if (!lock.ok) {
    throw new Error(lock.message);
  }
  log.info(`${exec.label}: installing clamav-daemon for ${profile} profile`);
  runChecked(exec, clamavDaemonPackageInstallCommand(), log);
}

/**
 * Idempotent ClamAV install + enable freshclam (definitions update in background).
 * Resource profile is derived from guest memory_mb (lean ≤3072, standard ≤8191, full above).
 *
 * @param {object} opts
 * @param {ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {number} [opts.memoryMb] guest memory_mb from deployment proxmox block
 * @returns {Promise<ClamavEnsureResult>}
 */
export async function ensureClamav({ exec, log, flags, memoryMb }) {
  if (clamavSkippedByFlags(flags)) {
    log.info(`${exec.label}: ClamAV skipped (--skip-clamav)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  const profile = resolveClamavProfile(memoryMb);
  log.info(`${exec.label}: ClamAV profile ${profile}${memoryMb ? ` (memory_mb=${memoryMb})` : ""}`);

  const check = exec.run(clamavInstalledCheckCommand(), { capture: true });
  const alreadyInstalled = check.status === 0;

  try {
    if (!alreadyInstalled) {
      const lock = await waitForAptLock(exec, log);
      if (!lock.ok) {
        return { ok: false, skipped: false, message: lock.message, profile, memory_mb: memoryMb };
      }

      log.info(`${exec.label}: installing ClamAV packages (${profile})`);
      runChecked(exec, clamavAptInstallCommandForProfile(profile), log);
    } else {
      log.info(`${exec.label}: ClamAV already installed — applying ${profile} profile`);
      await ensureClamavDaemonPackage(exec, profile, log);
    }

    runChecked(exec, clamavConfigApplyCommandForProfile(profile), log);
    runChecked(exec, clamavEnableServicesCommandForProfile(profile), log);

    const message = alreadyInstalled
      ? `already installed; ${profile} profile ensured`
      : `installed (${profile})`;
    log.info(
      `${exec.label}: ClamAV ${message}; virus definitions update via clamav-freshclam in the background`,
    );
    return { ok: true, skipped: false, message, profile, memory_mb: memoryMb };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: ClamAV ensure failed: ${msg}`);
    return { ok: false, skipped: false, message: msg, profile, memory_mb: memoryMb };
  }
}
