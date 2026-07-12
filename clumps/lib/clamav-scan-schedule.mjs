import { flagGet } from "./parse-argv-flags.mjs";
import {
  buildSystemdTimerInstallScript,
  ensureGuestSystemdTimer,
  staggerOffsetFromSystemId,
} from "./guest-systemd-unit-ensure.mjs";

/** @param {Record<string, string>} [flags] */
export function clamavScanScheduleSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-clamav-scan", "skip_clamav_scan") !== undefined;
}

/**
 * Build hdc-clamscan systemd units with daily stagger from system_id.
 *
 * @param {string} systemId
 */
export function buildClamavScanSystemdUnits(systemId) {
  const { hour, minute } = staggerOffsetFromSystemId(systemId, 1440);
  const onCalendar = `*-*-* ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  const serviceUnit = [
    "[Unit]",
    "Description=HDC scheduled ClamAV scan",
    "After=network.target clamav-freshclam.service",
    "",
    "[Service]",
    "Type=oneshot",
    "Nice=10",
    "IOSchedulingClass=idle",
    "ExecStart=/usr/bin/clamscan -r --infected --log=/var/log/hdc-clamscan.log /home /opt /var",
    "",
  ].join("\n");
  const timerUnit = [
    "[Unit]",
    "Description=HDC daily ClamAV scan timer",
    "",
    "[Timer]",
    `OnCalendar=${onCalendar}`,
    "Persistent=true",
    "RandomizedDelaySec=900",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
  return { name: "hdc-clamscan", serviceUnit, timerUnit, onCalendar };
}

/**
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {string} [opts.systemId]
 * @param {boolean} [opts.clamavInstalled]
 */
export async function ensureClamavScanSchedule(opts) {
  const skipReason = clamavScanScheduleSkippedByFlags(opts.flags);
  if (skipReason) {
    opts.log.info(`${opts.exec.label}: ClamAV scan schedule skipped (--skip-clamav-scan)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }
  if (opts.clamavInstalled === false) {
    return { ok: true, skipped: true, message: "clamav not installed" };
  }
  const systemId = String(opts.systemId ?? "unknown").trim() || "unknown";
  const units = buildClamavScanSystemdUnits(systemId);
  const result = ensureGuestSystemdTimer({ exec: opts.exec, log: opts.log, spec: units });
  if (result.ok) {
    return {
      ok: true,
      skipped: false,
      message: `daily scan at ${units.onCalendar}`,
      on_calendar: units.onCalendar,
    };
  }
  return result;
}

export { buildSystemdTimerInstallScript };
