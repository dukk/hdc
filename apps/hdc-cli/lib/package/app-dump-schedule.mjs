/**
 * Application-level dump schedule: systemd timer on the guest writing
 * consistent app dumps (pg_dumpall, sqlite .backup, minecraft worlds, …) into
 * a guest path that vzdump already snapshots. Guest-disk backups of a live
 * database can snapshot corruption; these dumps give a restorable second layer.
 */
import { flagGet } from "./parse-argv-flags.mjs";
import { staggerOffsetFromSystemId } from "./guest-systemd-unit-ensure.mjs";

/** Default guest directory for app dumps (under /var so vzdump + scans cover it). */
export const APP_DUMP_BASE_DIR = "/var/backups/hdc";

/** Default retention in days for pruned dump files. */
export const APP_DUMP_DEFAULT_RETAIN_DAYS = 7;

/** @param {Record<string, string>} [flags] */
export function appDumpSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-app-dump", "skip_app_dump") !== undefined;
}

/**
 * @param {string} name
 * @returns {string}
 */
export function appDumpScriptPath(name) {
  return `/usr/local/sbin/hdc-dump-${name}`;
}

/**
 * @param {string} name
 * @returns {string}
 */
export function appDumpOutputDir(name) {
  return `${APP_DUMP_BASE_DIR}/${name}`;
}

/**
 * @typedef {object} AppDumpSpec
 * @property {string} systemId
 * @property {string} name short app slug (postgresql, vaultwarden, minecraft)
 * @property {string[]} dumpCommands shell lines; may use $OUT (output dir) and $TS (timestamp)
 * @property {number} [retainDays] prune dump files older than this many days (default 7); ignored when pruneCommands set
 * @property {string} [onCalendar] override systemd OnCalendar (default: staggered daily)
 * @property {number} [randomizedDelaySec] timer RandomizedDelaySec (default 900)
 * @property {string[]} [pruneCommands] replace default find -mtime prune lines
 */

/**
 * Dump script body written to /usr/local/sbin/hdc-dump-<name> on the guest.
 *
 * @param {AppDumpSpec} spec
 * @returns {string}
 */
export function buildAppDumpScript(spec) {
  const outDir = appDumpOutputDir(spec.name);
  const retainDays = Number.isInteger(spec.retainDays) && /** @type {number} */ (spec.retainDays) > 0
    ? /** @type {number} */ (spec.retainDays)
    : APP_DUMP_DEFAULT_RETAIN_DAYS;
  const pruneCommands =
    Array.isArray(spec.pruneCommands) && spec.pruneCommands.length
      ? spec.pruneCommands
      : [`find "$OUT" -type f -mtime +${retainDays - 1} -delete`];
  return [
    "#!/bin/bash",
    `# hdc-generated app dump for ${spec.name} — do not edit (re-pushed by maintain)`,
    "set -euo pipefail",
    `OUT='${outDir}'`,
    'TS="$(date +%Y%m%d-%H%M%S)"',
    'mkdir -p "$OUT"',
    'chmod 700 "$OUT"',
    ...spec.dumpCommands,
    ...pruneCommands,
    "",
  ].join("\n");
}

/**
 * systemd service + timer bodies for the dump job (daily staggered unless onCalendar set).
 *
 * @param {AppDumpSpec} spec
 * @returns {{ name: string; serviceUnit: string; timerUnit: string; onCalendar: string; scriptPath: string }}
 */
export function buildAppDumpSystemdUnits(spec) {
  const unitName = `hdc-dump-${spec.name}`;
  const scriptPath = appDumpScriptPath(spec.name);
  let onCalendar =
    typeof spec.onCalendar === "string" && spec.onCalendar.trim() ? spec.onCalendar.trim() : "";
  if (!onCalendar) {
    // Different salt than hdc-clamscan so the two nightly jobs do not collide.
    const { hour, minute } = staggerOffsetFromSystemId(`${spec.systemId}:app-dump`, 1440);
    onCalendar = `*-*-* ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  }
  const delayRaw = Number(spec.randomizedDelaySec);
  const randomizedDelaySec = Number.isFinite(delayRaw) && delayRaw >= 0 ? Math.trunc(delayRaw) : 900;
  const serviceUnit = [
    "[Unit]",
    `Description=HDC app dump (${spec.name})`,
    "After=network.target",
    "",
    "[Service]",
    "Type=oneshot",
    "Nice=10",
    "IOSchedulingClass=idle",
    `ExecStart=${scriptPath}`,
    "",
  ].join("\n");
  const timerUnit = [
    "[Unit]",
    `Description=HDC app dump timer (${spec.name})`,
    "",
    "[Timer]",
    `OnCalendar=${onCalendar}`,
    "Persistent=true",
    `RandomizedDelaySec=${randomizedDelaySec}`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
  return { name: unitName, serviceUnit, timerUnit, onCalendar, scriptPath };
}

/**
 * Bash install script: write dump script + units, enable timer (runs on guest).
 *
 * @param {AppDumpSpec} spec
 * @returns {string}
 */
export function buildAppDumpInstallScript(spec) {
  const units = buildAppDumpSystemdUnits(spec);
  const script = buildAppDumpScript(spec);
  return [
    "set -e",
    `cat > '${units.scriptPath}' <<'HDC_DUMP_SCRIPT_EOF'`,
    script.trimEnd(),
    "HDC_DUMP_SCRIPT_EOF",
    `chmod 750 '${units.scriptPath}'`,
    `cat > '/etc/systemd/system/${units.name}.service' <<'HDC_SYSTEMD_SERVICE_EOF'`,
    units.serviceUnit,
    "HDC_SYSTEMD_SERVICE_EOF",
    `cat > '/etc/systemd/system/${units.name}.timer' <<'HDC_SYSTEMD_TIMER_EOF'`,
    units.timerUnit,
    "HDC_SYSTEMD_TIMER_EOF",
    "systemctl daemon-reload",
    `systemctl enable --now '${units.name}.timer'`,
    `systemctl is-active '${units.name}.timer' >/dev/null`,
  ].join("\n");
}

/**
 * Idempotent push of the dump script + systemd timer on the guest.
 *
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {AppDumpSpec} opts.spec
 * @returns {{ ok: boolean; skipped: boolean; message: string; on_calendar?: string; output_dir?: string }}
 */
export function ensureAppDumpSchedule(opts) {
  const { exec, log, spec } = opts;
  if (appDumpSkippedByFlags(opts.flags)) {
    log.info(`${exec.label}: app dump schedule skipped (--skip-app-dump)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }
  const units = buildAppDumpSystemdUnits(spec);
  try {
    log.info(`${exec.label}: ensuring app dump timer ${units.name}.timer (${units.onCalendar})`);
    const script = buildAppDumpInstallScript(spec);
    const r = exec.run(script, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    return {
      ok: true,
      skipped: false,
      message: `dump at ${units.onCalendar} → ${appDumpOutputDir(spec.name)}`,
      on_calendar: units.onCalendar,
      output_dir: appDumpOutputDir(spec.name),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: app dump timer ${units.name} failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}

/**
 * Dump commands for a PostgreSQL node (full-cluster pg_dumpall, gzip).
 * @returns {string[]}
 */
export function postgresqlDumpCommands() {
  return [
    'chown postgres:postgres "$OUT"',
    'sudo -u postgres pg_dumpall | gzip > "$OUT/pg_dumpall-$TS.sql.gz"',
  ];
}

/**
 * Dump commands for a Vaultwarden CT (sqlite .backup + data tar from the
 * named Docker volume; excludes the live db files and icon cache).
 *
 * @param {string} [volumeName] docker volume (default vaultwarden_vaultwarden-data)
 * @returns {string[]}
 */
export function vaultwardenDumpCommands(volumeName = "vaultwarden_vaultwarden-data") {
  const vol = volumeName.replace(/'/g, "");
  return [
    "command -v sqlite3 >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq sqlite3; }",
    `DATA="$(docker volume inspect -f '{{ .Mountpoint }}' '${vol}')"`,
    'sqlite3 "file:$DATA/db.sqlite3?mode=ro" ".backup \'$OUT/db-$TS.sqlite3\'"',
    'gzip -f "$OUT/db-$TS.sqlite3"',
    'tar -C "$DATA" -czf "$OUT/data-$TS.tar.gz" --exclude=./db.sqlite3 --exclude=./db.sqlite3-wal --exclude=./db.sqlite3-shm --exclude=./icon_cache .',
  ];
}

/**
 * OnCalendar for Minecraft world dumps every N hours (staggered minute).
 *
 * @param {string} systemId
 * @param {number} [intervalHours]
 * @returns {string}
 */
export function minecraftAppDumpOnCalendar(systemId, intervalHours = 6) {
  const hours = Number.isFinite(Number(intervalHours))
    ? Math.min(24, Math.max(1, Math.trunc(Number(intervalHours))))
    : 6;
  const { minute } = staggerOffsetFromSystemId(`${systemId}:minecraft-dump`, 60);
  return `*-*-* 00/${hours}:${String(minute).padStart(2, "0")}:00`;
}

/**
 * Dump commands for Paper Minecraft: flush via RCON, tar worlds + config/plugins.
 *
 * @param {string} [installDir]
 * @returns {string[]}
 */
export function minecraftDumpCommands(installDir = "/opt/minecraft") {
  const dir = String(installDir || "/opt/minecraft").replace(/'/g, "");
  return [
    `INSTALL_DIR='${dir}'`,
    "RCON=/usr/local/sbin/hdc-minecraft-rcon",
    "if systemctl is-active --quiet minecraft 2>/dev/null; then",
    '  "$RCON" save-off 2>/dev/null || true',
    '  "$RCON" "save-all flush" 2>/dev/null || true',
    "  sleep 2",
    "fi",
    'PATHS=()',
    "for p in world world_nether world_the_end server.properties whitelist.json ops.json banned-ips.json banned-players.json config plugins; do",
    '  if [ -e "$INSTALL_DIR/$p" ]; then PATHS+=("$p"); fi',
    "done",
    'if [ "${#PATHS[@]}" -eq 0 ]; then',
    '  echo "minecraft dump: nothing to archive under $INSTALL_DIR" >&2',
    "else",
    '  tar -C "$INSTALL_DIR" -czf "$OUT/minecraft-$TS.tar.gz" \\',
    "    --exclude='./plugins/*.jar' \\",
    "    --exclude='./plugins/BlueMap/web/maps' \\",
    "    --exclude='./plugins/BlueMap/data' \\",
    "    --exclude='./cache' \\",
    "    --exclude='./libraries' \\",
    "    --exclude='./versions' \\",
    "    --exclude='./logs' \\",
    "    --exclude='./.rcon.password' \\",
    '    "${PATHS[@]}"',
    "fi",
    "if systemctl is-active --quiet minecraft 2>/dev/null; then",
    '  "$RCON" save-on 2>/dev/null || true',
    "fi",
  ];
}

/**
 * Keep newest minecraft-YYYYMMDD-*.tar.gz per calendar day for the last retainDaily days.
 *
 * @param {number} [retainDaily]
 * @returns {string[]}
 */
export function minecraftDumpPruneCommands(retainDaily = 7) {
  const days =
    Number.isInteger(retainDaily) && retainDaily > 0 ? retainDaily : APP_DUMP_DEFAULT_RETAIN_DAYS;
  return [
    `python3 - "$OUT" ${days} <<'PY'`,
    "import re, sys",
    "from datetime import datetime, timedelta, timezone",
    "from pathlib import Path",
    "out = Path(sys.argv[1])",
    "retain = int(sys.argv[2])",
    "pat = re.compile(r'^minecraft-(\\d{8})-')",
    "files = sorted(out.glob('minecraft-*.tar.gz'), key=lambda p: p.name, reverse=True)",
    "by_day = {}",
    "for f in files:",
    "    m = pat.match(f.name)",
    "    if not m:",
    "        f.unlink(missing_ok=True)",
    "        continue",
    "    day = m.group(1)",
    "    if day in by_day:",
    "        f.unlink(missing_ok=True)",
    "    else:",
    "        by_day[day] = f",
    "cutoff = datetime.now(timezone.utc).date() - timedelta(days=retain - 1)",
    "for day, f in by_day.items():",
    "    d = datetime.strptime(day, '%Y%m%d').date()",
    "    if d < cutoff:",
    "        f.unlink(missing_ok=True)",
    "PY",
  ];
}
