import { spawnSync } from "node:child_process";

/**
 * Escape for single-quoted PowerShell string.
 * @param {string} s
 */
export function psQuote(s) {
  return s.replace(/'/g, "''");
}

/**
 * @param {object} opts
 * @param {string} opts.scriptBody
 * @param {number} [opts.timeoutMs]
 */
export function runLocalPowerShell(opts) {
  const timeoutMs = opts.timeoutMs ?? 900_000;
  const encoded = Buffer.from(opts.scriptBody, "utf16le").toString("base64");
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return {
    status: r.status ?? 1,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
    error: r.error,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.computerName
 * @param {number} opts.port
 * @param {boolean} opts.useSsl
 * @param {boolean} opts.skipCaCheck
 * @param {string} opts.username
 * @param {string} opts.password
 * @param {string} opts.remoteScript
 */
export function buildWinRmInvokeScript(opts) {
  const user = psQuote(opts.username);
  const pass = psQuote(opts.password);
  const cn = psQuote(opts.computerName);
  const remote = opts.remoteScript.trim();
  const sessionOpts = opts.skipCaCheck
    ? "$so = New-CimSessionOption -SkipCACheck -SkipCNCheck"
    : "$so = $null";
  const useSsl = opts.useSsl ? "$true" : "$false";
  return `
$ErrorActionPreference = 'Stop'
${sessionOpts}
$sec = ConvertTo-SecureString '${pass}' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('${user}', $sec)
$params = @{
  ComputerName = '${cn}'
  Port = ${opts.port}
  Credential = $cred
  Authentication = 'Negotiate'
  ScriptBlock = {
    ${remote}
  }
}
if ($so) { $params.SessionOption = $so }
if (${useSsl}) { $params.UseSSL = $true }
Invoke-Command @params
`.trim();
}
