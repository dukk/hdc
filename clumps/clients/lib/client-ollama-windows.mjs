import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { buildWinRmInvokeScript, psQuote } from "./client-winrm.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL_SCRIPT_PATH = join(__dirname, "..", "windows", "scripts", "Install-OllamaService.ps1");

/**
 * @param {unknown} v
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} host
 */
export function hostOllamaEnabled(host) {
  const o = isObject(host.ollama) ? host.ollama : {};
  return o.enabled === true || o.enabled === 1;
}

/**
 * @param {Record<string, unknown>} host
 */
export function resolveHostOllamaOpts(host) {
  const o = isObject(host.ollama) ? host.ollama : {};
  const modelsRaw = Array.isArray(o.models) ? o.models : [];
  /** @type {string[]} */
  const models = [];
  for (const m of modelsRaw) {
    if (typeof m === "string" && m.trim()) {
      models.push(m.trim());
      continue;
    }
    if (isObject(m) && typeof m.name === "string" && m.name.trim()) {
      models.push(m.name.trim());
    }
  }
  const sched = isObject(o.schedule) ? o.schedule : {};
  const scheduleEnabled = sched.enabled === true || sched.enabled === 1;
  const startLocal =
    typeof sched.start_local === "string" && sched.start_local.trim()
      ? sched.start_local.trim()
      : "23:00";
  const stopLocal =
    typeof sched.stop_local === "string" && sched.stop_local.trim()
      ? sched.stop_local.trim()
      : "08:00";
  return {
    enabled: hostOllamaEnabled(host),
    version: typeof o.version === "string" && o.version.trim() ? o.version.trim() : "",
    listen: typeof o.listen === "string" && o.listen.trim() ? o.listen.trim() : "0.0.0.0",
    origins: typeof o.origins === "string" && o.origins.trim() ? o.origins.trim() : "",
    models,
    installDir:
      typeof o.install_dir === "string" && o.install_dir.trim()
        ? o.install_dir.trim()
        : "C:\\Program Files\\Ollama",
    modelsDir:
      typeof o.models_dir === "string" && o.models_dir.trim()
        ? o.models_dir.trim()
        : "C:\\ProgramData\\Ollama\\models",
    serviceName:
      typeof o.service_name === "string" && o.service_name.trim() ? o.service_name.trim() : "Ollama",
    includeRocm: o.include_rocm === true || o.include_rocm === 1,
    includeMlx: o.include_mlx === true || o.include_mlx === 1,
    scheduleEnabled,
    scheduleStart: startLocal,
    scheduleStop: stopLocal,
  };
}

/**
 * @returns {string}
 */
export function loadInstallOllamaServiceScript() {
  return readFileSync(INSTALL_SCRIPT_PATH, "utf8");
}

/**
 * Build a remote PowerShell snippet that writes Install-OllamaService.ps1 and runs it.
 * @param {object} opts
 * @param {ReturnType<typeof resolveHostOllamaOpts>} opts.ollama
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.skipModels]
 * @param {boolean} [opts.statusOnly]
 */
export function buildRemoteOllamaScript(opts) {
  const { ollama, dryRun = false, skipModels = false, statusOnly = false } = opts;
  const scriptB64 = Buffer.from(loadInstallOllamaServiceScript(), "utf8").toString("base64");
  const modelsLiteral =
    ollama.models.length > 0
      ? `@(${ollama.models.map((m) => `'${psQuote(m)}'`).join(",")})`
      : "@()";
  const switches = [];
  if (dryRun) switches.push("-DryRun");
  if (skipModels) switches.push("-SkipModels");
  if (statusOnly) switches.push("-StatusOnly");
  if (ollama.includeRocm) switches.push("-IncludeRocm");
  if (ollama.includeMlx) switches.push("-IncludeMlx");
  if (ollama.scheduleEnabled) switches.push("-ScheduleEnabled");
  const switchStr = switches.length ? ` ${switches.join(" ")}` : "";
  const versionArg = ollama.version ? ` -Version '${psQuote(ollama.version)}'` : "";
  const originsArg = ollama.origins ? ` -Origins '${psQuote(ollama.origins)}'` : "";
  const scheduleArgs = ollama.scheduleEnabled
    ? ` -ScheduleStart '${psQuote(ollama.scheduleStart)}' -ScheduleStop '${psQuote(ollama.scheduleStop)}'`
    : "";

  return `
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $env:TEMP ('hdc-Install-OllamaService-' + [guid]::NewGuid().ToString('n') + '.ps1')
try {
  $b64 = '${scriptB64}'
  [IO.File]::WriteAllBytes($scriptPath, [Convert]::FromBase64String($b64))
  & $scriptPath \`
    -InstallDir '${psQuote(ollama.installDir)}' \`
    -ModelsDir '${psQuote(ollama.modelsDir)}' \`
    -ServiceName '${psQuote(ollama.serviceName)}' \`
    -ListenHost '${psQuote(ollama.listen)}' \`
    -Models ${modelsLiteral}${versionArg}${originsArg}${scheduleArgs}${switchStr}
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 0 }
  if ($code -ne 0) { exit $code }
} finally {
  if (Test-Path -LiteralPath $scriptPath) {
    Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
  }
}
`.trim();
}

/**
 * @param {string} text
 */
function parseJsonTail(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.lastIndexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Run a large local PowerShell script via -File (avoids CreateProcess ~32K EncodedCommand limit).
 * @param {object} opts
 * @param {string} opts.scriptBody
 * @param {number} [opts.timeoutMs]
 */
function runLocalPowerShellFile(opts) {
  const timeoutMs = opts.timeoutMs ?? 900_000;
  const path = join(tmpdir(), `hdc-winrm-ollama-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
  try {
    writeFileSync(path, opts.scriptBody, "utf8");
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path],
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
  } finally {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {object} conn WinRM connection fields for buildWinRmInvokeScript
 * @param {object} opts
 * @param {ReturnType<typeof resolveHostOllamaOpts>} opts.ollama
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.skipModels]
 * @param {boolean} [opts.statusOnly]
 * @param {(msg: string) => void} [opts.log]
 */
export function runWindowsOllama(conn, opts) {
  const { ollama, dryRun = false, skipModels = false, statusOnly = false, log } = opts;
  const label = statusOnly ? "query Ollama status" : dryRun ? "dry-run Ollama install" : "ensure Ollama service";
  if (log) log(label);

  const remoteScript = buildRemoteOllamaScript({
    ollama,
    dryRun,
    skipModels,
    statusOnly,
  });
  const script = buildWinRmInvokeScript({ ...conn, remoteScript });
  const timeoutMs = statusOnly ? 120_000 : 3_600_000;
  // EncodedCommand cannot hold the embedded installer (~15KB+); use -File instead.
  const r = runLocalPowerShellFile({ scriptBody: script, timeoutMs });
  const parsed = parseJsonTail(r.stdout);
  if (r.status !== 0) {
    return {
      ok: false,
      message: r.stderr || r.stdout || `Ollama ${statusOnly ? "status" : "install"} failed`,
      stdout: r.stdout || undefined,
      status: parsed ?? undefined,
    };
  }
  if (!parsed) {
    return {
      ok: false,
      message: "Ollama script returned no JSON status",
      stdout: r.stdout || undefined,
    };
  }
  const ok = parsed.ok === true || parsed.ok === "True" || dryRun;
  return {
    ok,
    status: parsed,
    message: ok ? undefined : String(parsed.message ?? parsed.service_status ?? "ollama not healthy"),
  };
}

/**
 * @param {object} conn
 * @param {ReturnType<typeof resolveHostOllamaOpts>} ollama
 * @param {(msg: string) => void} [log]
 */
export function queryWindowsOllama(conn, ollama, log) {
  return runWindowsOllama(conn, { ollama, statusOnly: true, log });
}

/**
 * @param {object} conn
 * @param {object} opts
 * @param {ReturnType<typeof resolveHostOllamaOpts>} opts.ollama
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.skipModels]
 * @param {(msg: string) => void} [opts.log]
 */
export function ensureWindowsOllama(conn, opts) {
  return runWindowsOllama(conn, {
    ollama: opts.ollama,
    dryRun: opts.dryRun === true,
    skipModels: opts.skipModels === true,
    statusOnly: false,
    log: opts.log,
  });
}

/**
 * Force-start the Ollama Windows service and probe the local API (schedule override).
 * @param {object} conn
 * @param {ReturnType<typeof resolveHostOllamaOpts>} ollama
 * @param {(msg: string) => void} [log]
 */
export function startWindowsOllama(conn, ollama, log) {
  const serviceName = ollama.serviceName || "Ollama";
  log?.(`start Ollama service ${serviceName}`);
  const remoteScript = `
$ErrorActionPreference = 'Continue'
$svcName = '${psQuote(serviceName)}'
Start-Service -Name $svcName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5
$svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
$status = if ($svc) { $svc.Status.ToString() } else { 'Missing' }
$http = $null
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 10
  $http = [int]$r.StatusCode
} catch {
  $http = $_.Exception.Message
}
$ok = ($status -eq 'Running') -and ($http -eq 200)
@{ ok = $ok; service_status = $status; api = $http } | ConvertTo-Json -Compress
`.trim();
  const script = buildWinRmInvokeScript({ ...conn, remoteScript });
  const r = runLocalPowerShellFile({ scriptBody: script, timeoutMs: 120_000 });
  const parsed = parseJsonTail(r.stdout);
  if (r.status !== 0 || !parsed) {
    return {
      ok: false,
      message: r.stderr || r.stdout || "Ollama start failed",
      stdout: r.stdout || undefined,
      status: parsed ?? undefined,
    };
  }
  const ok = parsed.ok === true || parsed.ok === "True";
  return {
    ok,
    status: parsed,
    message: ok ? undefined : String(parsed.service_status ?? "ollama not running"),
  };
}

/**
 * Pull configured models without reinstalling the service (WinRM, synchronous).
 * @param {object} conn
 * @param {ReturnType<typeof resolveHostOllamaOpts>} ollama
 * @param {{ dryRun?: boolean; log?: (msg: string) => void }} [opts]
 */
export function pullWindowsOllamaModels(conn, ollama, opts = {}) {
  const { dryRun = false, log } = opts;
  if (!ollama.models.length) {
    return { ok: false, message: "no models configured for this host" };
  }
  log?.(dryRun ? "dry-run model pull" : `pull ${ollama.models.length} model(s)`);
  const modelsLiteral = `@(${ollama.models.map((m) => `'${psQuote(m)}'`).join(",")})`;
  const remoteScript = dryRun
    ? `@{ ok = $true; dry_run = $true; models = ${modelsLiteral} } | ConvertTo-Json -Compress`
    : `
$ErrorActionPreference = 'Stop'
$exe = Join-Path '${psQuote(ollama.installDir)}' 'ollama.exe'
Start-Service -Name '${psQuote(ollama.serviceName)}' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
try {
  foreach ($m in ${modelsLiteral}) {
    Write-Output ('pull ' + $m)
    & $exe pull $m
    if ($LASTEXITCODE -ne 0) { throw "pull failed $LASTEXITCODE for $m" }
  }
  @{ ok = $true; models = ${modelsLiteral} } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
}
`.trim();
  const script = buildWinRmInvokeScript({ ...conn, remoteScript });
  const r = runLocalPowerShellFile({ scriptBody: script, timeoutMs: 3_600_000 });
  const parsed = parseJsonTail(r.stdout);
  if (dryRun) {
    return { ok: true, dry_run: true, status: parsed ?? { models: ollama.models } };
  }
  if (r.status !== 0 || !parsed) {
    return {
      ok: false,
      message: r.stderr || r.stdout || "Ollama model pull failed",
      stdout: r.stdout || undefined,
      status: parsed ?? undefined,
    };
  }
  const ok = parsed.ok === true || parsed.ok === "True";
  return {
    ok,
    status: parsed,
    message: ok ? undefined : String(parsed.message ?? "model pull failed"),
  };
}
