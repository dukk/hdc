import { buildWinRmInvokeScript, runLocalPowerShell } from "./client-winrm.mjs";

const PENDING_UPDATES_SCRIPT = `
$rs = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher().Search('IsInstalled=0')
$rs.Updates.Count
`.trim();

const INSTALL_UPDATES_SCRIPT = `
if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) {
  throw 'PSWindowsUpdate module not installed on target; install manually or run with module bootstrap'
}
Import-Module PSWindowsUpdate -ErrorAction Stop
Install-WindowsUpdate -AcceptAll -IgnoreReboot -ErrorAction Stop | Out-Null
'installed'
`.trim();

const REBOOT_REQUIRED_SCRIPT = `
Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired'
`.trim();

const REBOOT_SCRIPT = `Restart-Computer -Force`.trim();

export function queryWindowsRebootRequired(conn) {
  const script = buildWinRmInvokeScript({ ...conn, remoteScript: REBOOT_REQUIRED_SCRIPT });
  const r = runLocalPowerShell({ scriptBody: script });
  if (r.status !== 0) {
    return { ok: false, message: r.stderr || r.stdout || "WinRM reboot query failed" };
  }
  return { ok: true, reboot_required: r.stdout.toLowerCase().includes("true") };
}

/**
 * @param {object} conn
 */
export function queryWindowsPendingUpdates(conn) {
  const script = buildWinRmInvokeScript({ ...conn, remoteScript: PENDING_UPDATES_SCRIPT });
  const r = runLocalPowerShell({ scriptBody: script });
  if (r.status !== 0) {
    return { ok: false, message: r.stderr || r.stdout || "WinRM query failed" };
  }
  const n = parseInt(r.stdout.trim(), 10);
  return { ok: true, pending_updates: Number.isFinite(n) ? n : null };
}

/**
 * @param {object} opts
 * @param {object} opts.conn
 * @param {boolean} opts.skipUpdates
 * @param {boolean} opts.reboot
 * @param {boolean} opts.dryRun
 */
export function maintainWindowsHost(opts) {
  const { conn, skipUpdates, reboot, dryRun } = opts;
  if (dryRun) {
    return { ok: true, dry_run: true };
  }

  if (!skipUpdates) {
    const script = buildWinRmInvokeScript({ ...conn, remoteScript: INSTALL_UPDATES_SCRIPT });
    const r = runLocalPowerShell({ scriptBody: script, timeoutMs: 3_600_000 });
    if (r.status !== 0) {
      return {
        ok: false,
        message: r.stderr || r.stdout || "Windows Update install failed",
        hint: "Install PSWindowsUpdate on the target (Install-Module PSWindowsUpdate -Force)",
      };
    }
  }

  const rbScript = buildWinRmInvokeScript({ ...conn, remoteScript: REBOOT_REQUIRED_SCRIPT });
  const rbCheck = runLocalPowerShell({ scriptBody: rbScript });
  const rebootRequired = rbCheck.stdout.toLowerCase().includes("true");
  if (!rebootRequired) {
    return { ok: true, reboot_required: false };
  }
  if (!reboot) {
    return { ok: true, reboot_required: true, rebooted: false };
  }

  const rebootScript = buildWinRmInvokeScript({ ...conn, remoteScript: REBOOT_SCRIPT });
  runLocalPowerShell({ scriptBody: rebootScript, timeoutMs: 120_000 });
  return { ok: true, reboot_required: true, rebooted: true };
}
