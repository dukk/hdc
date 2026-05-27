import { flagGet } from "./parse-argv-flags.mjs";
import { waitForAptLock } from "./apt-lock-wait.mjs";

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
 */

/** @returns {string} */
export function clamavInstalledCheckCommand() {
  return "dpkg -s clamav >/dev/null 2>&1";
}

/** @returns {string} */
export function clamavAptInstallCommand() {
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq clamav clamav-daemon clamav-freshclam",
  ].join(" && ");
}

/** @returns {string} */
export function clamavEnableServicesCommand() {
  return [
    "systemctl enable clamav-freshclam 2>/dev/null || true",
    "systemctl start clamav-freshclam 2>/dev/null || true",
    "if systemctl list-unit-files clamav-daemon.service >/dev/null 2>&1; then",
    "  systemctl enable clamav-daemon 2>/dev/null || true",
    "  systemctl start clamav-daemon 2>/dev/null || true",
    "fi",
  ].join("\n");
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
 * Idempotent ClamAV install + enable freshclam (definitions update in background).
 *
 * @param {object} opts
 * @param {ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @returns {Promise<ClamavEnsureResult>}
 */
export async function ensureClamav({ exec, log, flags }) {
  if (clamavSkippedByFlags(flags)) {
    log.info(`${exec.label}: ClamAV skipped (--skip-clamav)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  const check = exec.run(clamavInstalledCheckCommand(), { capture: true });
  const alreadyInstalled = check.status === 0;

  try {
    if (alreadyInstalled) {
      log.info(`${exec.label}: ClamAV already installed — ensuring services`);
      runChecked(exec, clamavEnableServicesCommand(), log);
      return { ok: true, skipped: false, message: "already installed; services ensured" };
    }

    const lock = await waitForAptLock(exec, log);
    if (!lock.ok) {
      return { ok: false, skipped: false, message: lock.message };
    }

    log.info(`${exec.label}: installing ClamAV packages`);
    runChecked(exec, clamavAptInstallCommand(), log);
    runChecked(exec, clamavEnableServicesCommand(), log);
    log.info(
      `${exec.label}: ClamAV installed; virus definitions will update via clamav-freshclam in the background`,
    );
    return { ok: true, skipped: false, message: "installed" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: ClamAV ensure failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
