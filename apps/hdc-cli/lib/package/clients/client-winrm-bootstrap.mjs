import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { tcpReachability } from "./client-reachability.mjs";

const DEFAULT_WAIT_SECONDS = 90;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;

const COMMON_PSEXEC_PATHS = [
  "C:\\Tools\\Sysinternals\\PsExec.exe",
  "C:\\Sysinternals\\PsExec.exe",
  "C:\\Program Files\\Sysinternals\\PsExec.exe",
];

/**
 * @param {unknown} v
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function winrmBootstrapDefaultsFromConfig(cfg) {
  const boot = isObject(cfg.winrm_bootstrap) ? cfg.winrm_bootstrap : {};
  return {
    enabled: boot.enabled !== false && boot.enabled !== 0,
    psexecPath:
      typeof boot.psexec_path === "string" && boot.psexec_path.trim() ? boot.psexec_path.trim() : "",
    waitSeconds:
      typeof boot.wait_seconds === "number" && boot.wait_seconds > 0
        ? Math.round(boot.wait_seconds)
        : DEFAULT_WAIT_SECONDS,
    pollIntervalSeconds:
      typeof boot.poll_interval_seconds === "number" && boot.poll_interval_seconds > 0
        ? Math.round(boot.poll_interval_seconds)
        : DEFAULT_POLL_INTERVAL_SECONDS,
  };
}

/**
 * @param {string} cmd
 * @param {NodeJS.ProcessEnv} [env]
 */
function whichOnWindows(cmd, env = process.env) {
  const r = spawnSync("where.exe", [cmd], {
    encoding: "utf8",
    windowsHide: true,
    env,
    timeout: 10_000,
  });
  if (r.status !== 0) return null;
  const line = (r.stdout ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return line || null;
}

/**
 * Resolve PsExec.exe: config path → HDC_PSEXEC_PATH → where PsExec → common paths.
 *
 * @param {ReturnType<typeof winrmBootstrapDefaultsFromConfig>} bootstrap
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ok: true, path: string } | { ok: false, message: string }}
 */
export function resolvePsExecPath(bootstrap, env) {
  const candidates = [];
  if (bootstrap.psexecPath) candidates.push(bootstrap.psexecPath);
  if (typeof env.HDC_PSEXEC_PATH === "string" && env.HDC_PSEXEC_PATH.trim()) {
    candidates.push(env.HDC_PSEXEC_PATH.trim());
  }
  const fromPath = whichOnWindows("PsExec.exe", env) ?? whichOnWindows("PsExec", env);
  if (fromPath) candidates.push(fromPath);
  candidates.push(...COMMON_PSEXEC_PATHS);

  for (const p of candidates) {
    if (p && existsSync(p)) return { ok: true, path: p };
  }
  return {
    ok: false,
    message:
      "PsExec.exe not found. Install Sysinternals PsExec, add it to PATH, or set winrm_bootstrap.psexec_path / HDC_PSEXEC_PATH in config.",
  };
}

/**
 * PowerShell run on the remote host as SYSTEM via PsExec.
 * Configures WinRM + HTTPS listener on 5986 for hdc defaults.
 */
export function buildWinRmBootstrapRemoteScript() {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '& "$env:SystemRoot\\System32\\winrm.cmd" quickconfig -quiet',
    "Enable-PSRemoting -Force -SkipNetworkProfileCheck",
    "Set-Service WinRM -StartupType Automatic",
    "Start-Service WinRM",
    "$https = Get-ChildItem WSMan:\\localhost\\Listener -ErrorAction SilentlyContinue | Where-Object { $_.Keys -match 'Transport=HTTPS' }",
    "if (-not $https) {",
    "  $dns = @($env:COMPUTERNAME)",
    '  if ($env:USERDNSDOMAIN) { $dns += "$env:COMPUTERNAME.$env:USERDNSDOMAIN" }',
    "  $cert = New-SelfSignedCertificate -DnsName $dns -CertStoreLocation Cert:\\LocalMachine\\My -KeyUsage DigitalSignature, KeyEncipherment -Provider 'Microsoft RSA SChannel Cryptographic Provider'",
    "  $thumb = $cert.Thumbprint",
    "  $hostName = $env:COMPUTERNAME",
    '  $listenerArgs = "@{Hostname=`"$hostName`";CertificateThumbprint=`"$thumb`"}"',
    '  & "$env:SystemRoot\\System32\\winrm.cmd" create winrm/config/Listener?Address=*+Transport=HTTPS $listenerArgs',
    "}",
    "if (-not (Get-NetFirewallRule -DisplayName 'WinRM HTTPS (HDC)' -ErrorAction SilentlyContinue)) {",
    "  New-NetFirewallRule -DisplayName 'WinRM HTTPS (HDC)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5986 -Profile Any | Out-Null",
    "}",
    "'ok'",
  ];
  return lines.join("\n");
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} opts.psexecPath
 * @param {boolean} [opts.dryRun]
 */
export function buildPsExecBootstrapArgv(opts) {
  const remoteScript = buildWinRmBootstrapRemoteScript();
  const encoded = Buffer.from(remoteScript, "utf16le").toString("base64");
  const target = opts.host.includes("\\") ? opts.host : `\\\\${opts.host}`;
  return [
    target,
    "-accepteula",
    "-nobanner",
    "-s",
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encoded,
  ];
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} opts.psexecPath
 * @param {boolean} [opts.dryRun]
 * @returns {{ ok: boolean, status?: number, stdout?: string, stderr?: string, message?: string, dry_run?: boolean }}
 */
export function runPsExecBootstrap(opts) {
  if (opts.dryRun) {
    return { ok: true, dry_run: true, message: "dry-run: would run PsExec WinRM bootstrap" };
  }
  const argv = buildPsExecBootstrapArgv(opts);
  const r = spawnSync(opts.psexecPath, argv, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const status = r.status ?? 1;
  const stdout = (r.stdout ?? "").trim();
  const stderr = (r.stderr ?? "").trim();
  if (status !== 0) {
    const detail = stderr || stdout || r.error?.message || `exit ${status}`;
    return {
      ok: false,
      status,
      stdout,
      stderr,
      message: `PsExec bootstrap failed: ${detail}`,
    };
  }
  return { ok: true, status, stdout, stderr };
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {number} opts.waitSeconds
 * @param {number} opts.pollIntervalSeconds
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<boolean>}
 */
export async function waitForWinRmPort(opts) {
  const log = opts.log ?? (() => {});
  const deadline = Date.now() + opts.waitSeconds * 1000;
  while (Date.now() < deadline) {
    const state = await tcpReachability(opts.host, opts.port);
    if (state === "open") return true;
    log(`waiting for WinRM port ${opts.port} on ${opts.host} (${state}) …`);
    await new Promise((r) => setTimeout(r, opts.pollIntervalSeconds * 1000));
  }
  return false;
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {ReturnType<typeof winrmBootstrapDefaultsFromConfig>} opts.bootstrap
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {boolean} [opts.dryRun]
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ ok: boolean, message?: string, attempted?: boolean, dry_run?: boolean }>}
 */
export async function ensureWinRmViaPsExec(opts) {
  const log = opts.log ?? (() => {});

  if (process.platform !== "win32") {
    return {
      ok: false,
      attempted: false,
      message: "WinRM PsExec bootstrap requires running hdc on Windows",
    };
  }

  const state = await tcpReachability(opts.host, opts.port);
  if (state === "open") {
    return { ok: true, attempted: false, message: "WinRM port already open" };
  }

  if (!opts.bootstrap.enabled) {
    return {
      ok: false,
      attempted: false,
      message: `WinRM port ${opts.port} not open (winrm_bootstrap disabled in config)`,
    };
  }

  const resolved = resolvePsExecPath(opts.bootstrap, opts.env);
  if (!resolved.ok) {
    return { ok: false, attempted: true, message: resolved.message };
  }

  log(`WinRM port ${opts.port} not open on ${opts.host}; bootstrapping via PsExec …`);

  const exec = runPsExecBootstrap({
    host: opts.host,
    psexecPath: resolved.path,
    dryRun: opts.dryRun,
  });
  if (!exec.ok) {
    return { ok: false, attempted: true, message: exec.message };
  }
  if (exec.dry_run) {
    return { ok: true, attempted: true, dry_run: true, message: exec.message };
  }

  const ready = await waitForWinRmPort({
    host: opts.host,
    port: opts.port,
    waitSeconds: opts.bootstrap.waitSeconds,
    pollIntervalSeconds: opts.bootstrap.pollIntervalSeconds,
    log,
  });
  if (!ready) {
    return {
      ok: false,
      attempted: true,
      message: `PsExec bootstrap finished but WinRM port ${opts.port} did not become reachable within ${opts.bootstrap.waitSeconds}s`,
    };
  }
  return { ok: true, attempted: true, message: "WinRM bootstrapped via PsExec" };
}
