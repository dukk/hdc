import { createHash } from "node:crypto";

/**
 * Deterministic stagger offset from system id (same id → same offset).
 *
 * @param {string} systemId
 * @param {number} windowMinutes minutes in [0, windowMinutes)
 * @returns {{ hour: number; minute: number; randomSleepSec: number }}
 */
export function staggerOffsetFromSystemId(systemId, windowMinutes = 1440) {
  const id = String(systemId ?? "").trim() || "unknown";
  const hash = createHash("sha256").update(id).digest();
  const window = Math.max(1, Math.floor(windowMinutes));
  const totalMinutes = (hash.readUInt32BE(0) >>> 0) % window;
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const randomSleepSec = (hash.readUInt32BE(4) >>> 0) % 3600;
  return { hour, minute, randomSleepSec };
}

/**
 * @typedef {object} SystemdUnitSpec
 * @property {string} name unit basename without extension (e.g. hdc-clamscan)
 * @property {string} serviceUnit full .service file body
 * @property {string} timerUnit full .timer file body
 */

/**
 * Bash script to write systemd unit files and enable timer (runs on guest).
 *
 * @param {SystemdUnitSpec} spec
 * @returns {string}
 */
export function buildSystemdTimerInstallScript(spec) {
  const name = String(spec.name).trim();
  const servicePath = `/etc/systemd/system/${name}.service`;
  const timerPath = `/etc/systemd/system/${name}.timer`;
  return [
    "set -e",
    `cat > '${servicePath}' <<'HDC_SYSTEMD_SERVICE_EOF'`,
    spec.serviceUnit,
    "HDC_SYSTEMD_SERVICE_EOF",
    `cat > '${timerPath}' <<'HDC_SYSTEMD_TIMER_EOF'`,
    spec.timerUnit,
    "HDC_SYSTEMD_TIMER_EOF",
    "systemctl daemon-reload",
    `systemctl enable --now '${name}.timer'`,
    `systemctl is-active '${name}.timer' >/dev/null`,
  ].join("\n");
}

/**
 * @typedef {import("./clamav-ensure.mjs").ConfigureExec} ConfigureExec
 */

/**
 * Idempotent push of systemd service + timer on guest.
 *
 * @param {object} opts
 * @param {ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {SystemdUnitSpec} opts.spec
 * @returns {{ ok: boolean; skipped: boolean; message: string }}
 */
export function ensureGuestSystemdTimer(opts) {
  const { exec, log, spec } = opts;
  const name = String(spec.name).trim();
  if (!name) {
    return { ok: false, skipped: false, message: "systemd unit name required" };
  }
  try {
    log.info(`${exec.label}: ensuring systemd timer ${name}.timer`);
    const script = buildSystemdTimerInstallScript(spec);
    const r = exec.run(script, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    return { ok: true, skipped: false, message: `${name}.timer enabled` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.log.warn) log.warn(`${exec.label}: systemd timer ${name} failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
