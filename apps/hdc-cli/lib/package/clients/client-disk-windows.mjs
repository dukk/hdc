import { buildWinRmInvokeScript, runLocalPowerShell } from "./client-winrm.mjs";

const DISK_SCRIPT = `
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
  Select-Object DeviceID,
    @{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}},
    @{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,2)}},
    @{N='UsedPct';E={if($_.Size -gt 0){[math]::Round(100*($_.Size-$_.FreeSpace)/$_.Size,1)}else{0}}} |
  ConvertTo-Json -Compress
`.trim();

/**
 * @param {object} conn
 * @param {string} conn.computerName
 * @param {number} conn.port
 * @param {boolean} conn.useSsl
 * @param {boolean} conn.skipCaCheck
 * @param {string} conn.username
 * @param {string} conn.password
 */
export function queryWindowsDisk(conn) {
  const script = buildWinRmInvokeScript({ ...conn, remoteScript: DISK_SCRIPT });
  const r = runLocalPowerShell({ scriptBody: script });
  if (r.status !== 0) {
    return { ok: false, message: `${r.stderr || r.stdout || r.error?.message || "WinRM failed"}` };
  }
  try {
    const disks = JSON.parse(r.stdout);
    const list = Array.isArray(disks) ? disks : [disks];
    return { ok: true, disks: list };
  } catch {
    return { ok: true, disks_raw: r.stdout };
  }
}
