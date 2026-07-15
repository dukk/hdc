import { join } from "node:path";

import { repoRoot } from "../../paths.mjs";
import { createPackageVaultAccess } from "../package-vault-access.mjs";
import { loadClumpConfigFromClumpRoot } from "../clump-run-config.mjs";
import { resolveMeshcentralDeployments } from "hdc/clump/services/meshcentral/lib/deployments.mjs";
import {
  listNormalizedDevices,
  meshcentralFromDeployments,
  openMeshcentralSession,
} from "hdc/clump/services/meshcentral/lib/meshcentral-session.mjs";
import { runOnDevice } from "hdc/clump/services/meshcentral/lib/meshcentral-runcommand.mjs";
import {
  loadInstallOllamaServiceScript,
  resolveHostOllamaOpts,
} from "./client-ollama-windows.mjs";
import { psQuote } from "./client-winrm.mjs";

/** MeshCentral runcommands payload size is limited; keep each chunk well under ~8 KiB. */
const CHUNK_CHARS = 6000;
const REMOTE_SCRIPT_PATH = "C:\\ProgramData\\HDC\\Install-OllamaService.ps1";
const REMOTE_WRAPPER_PATH = "C:\\ProgramData\\HDC\\run-ollama-install.ps1";
const REMOTE_OUT_PATH = "C:\\ProgramData\\HDC\\ollama-install.out";
const REMOTE_DONE_PATH = "C:\\ProgramData\\HDC\\ollama-install.done";

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
 * @param {ReturnType<typeof resolveHostOllamaOpts>} ollama
 * @param {{ dryRun?: boolean; skipModels?: boolean; statusOnly?: boolean }} opts
 */
function buildArgLine(ollama, opts) {
  const { dryRun = false, skipModels = false, statusOnly = false } = opts;
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
  return (
    `-InstallDir '${psQuote(ollama.installDir)}' ` +
    `-ModelsDir '${psQuote(ollama.modelsDir)}' ` +
    `-ServiceName '${psQuote(ollama.serviceName)}' ` +
    `-ListenHost '${psQuote(ollama.listen)}' ` +
    `-Models ${modelsLiteral}${versionArg}${originsArg}${scheduleArgs}${switchStr}`
  );
}

/**
 * Sync launcher (status-only / dry-run) — short enough for MeshCentral reply:true.
 * @param {ReturnType<typeof resolveHostOllamaOpts>} ollama
 * @param {{ dryRun?: boolean; skipModels?: boolean; statusOnly?: boolean }} opts
 */
function buildSyncLauncherScript(ollama, opts) {
  // Prefer nested Bypass -File — MeshCentral agent sessions often reject unsigned `& script.ps1`.
  /** @type {string[]} */
  const childArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    REMOTE_SCRIPT_PATH,
    "-InstallDir",
    ollama.installDir,
    "-ModelsDir",
    ollama.modelsDir,
    "-ServiceName",
    ollama.serviceName,
    "-ListenHost",
    ollama.listen,
  ];
  if (ollama.models.length) childArgs.push("-Models", ...ollama.models);
  if (ollama.version) childArgs.push("-Version", ollama.version);
  if (ollama.origins) childArgs.push("-Origins", ollama.origins);
  if (ollama.includeRocm) childArgs.push("-IncludeRocm");
  if (ollama.includeMlx) childArgs.push("-IncludeMlx");
  if (opts.dryRun) childArgs.push("-DryRun");
  if (opts.skipModels) childArgs.push("-SkipModels");
  if (opts.statusOnly) childArgs.push("-StatusOnly");
  if (ollama.scheduleEnabled) {
    childArgs.push(
      "-ScheduleEnabled",
      "-ScheduleStart",
      ollama.scheduleStart,
      "-ScheduleStop",
      ollama.scheduleStop,
    );
  }
  const psArgArray = "@(" + childArgs.map((a) => `'${psQuote(a)}'`).join(",") + ")";
  return `
$ErrorActionPreference = 'Stop'
$scriptPath = '${REMOTE_SCRIPT_PATH.replace(/\\/g, "\\\\")}'
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "missing installer $scriptPath" }
Unblock-File -LiteralPath $scriptPath -ErrorAction SilentlyContinue
$outFile = Join-Path $env:TEMP ('hdc-ollama-sync-' + [guid]::NewGuid().ToString('n') + '.out')
$errFile = Join-Path $env:TEMP ('hdc-ollama-sync-' + [guid]::NewGuid().ToString('n') + '.err')
$argsList = ${psArgArray}
try {
  $p = Start-Process -FilePath powershell.exe -ArgumentList $argsList -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  if (Test-Path -LiteralPath $outFile) { Get-Content -LiteralPath $outFile -Raw }
  if (Test-Path -LiteralPath $errFile) { Get-Content -LiteralPath $errFile -Raw | ForEach-Object { [Console]::Error.WriteLine($_) } }
  if ($null -eq $p.ExitCode) { exit 1 }
  exit $p.ExitCode
} finally {
  Remove-Item -LiteralPath $outFile,$errFile -Force -ErrorAction SilentlyContinue
}
`.trim();
}

/**
 * Queue install via a one-shot scheduled task (returns immediately to MeshCentral).
 * @param {ReturnType<typeof resolveHostOllamaOpts>} ollama
 * @param {{ dryRun?: boolean; skipModels?: boolean }} opts
 */
function buildAsyncStartScript(ollama, opts) {
  // MeshCentral's agent PowerShell often runs under AllSigned; `& script.ps1` fails.
  // Nested `powershell -ExecutionPolicy Bypass -File` works (verified on LAN clients).
  /** @type {string[]} */
  const childArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    REMOTE_SCRIPT_PATH,
    "-InstallDir",
    ollama.installDir,
    "-ModelsDir",
    ollama.modelsDir,
    "-ServiceName",
    ollama.serviceName,
    "-ListenHost",
    ollama.listen,
  ];
  if (ollama.models.length) childArgs.push("-Models", ...ollama.models);
  if (ollama.version) childArgs.push("-Version", ollama.version);
  if (ollama.origins) childArgs.push("-Origins", ollama.origins);
  if (ollama.includeRocm) childArgs.push("-IncludeRocm");
  if (ollama.includeMlx) childArgs.push("-IncludeMlx");
  if (opts.dryRun) childArgs.push("-DryRun");
  if (opts.skipModels) childArgs.push("-SkipModels");
  if (ollama.scheduleEnabled) {
    childArgs.push(
      "-ScheduleEnabled",
      "-ScheduleStart",
      ollama.scheduleStart,
      "-ScheduleStop",
      ollama.scheduleStop,
    );
  }
  const psArgArray = "@(" + childArgs.map((a) => `'${psQuote(a)}'`).join(",") + ")";
  const wrapperBody = `
$ErrorActionPreference = 'Continue'
$out = '${REMOTE_OUT_PATH.replace(/\\/g, "\\\\")}'
$err = 'C:\\ProgramData\\HDC\\ollama-install.err'
$done = '${REMOTE_DONE_PATH.replace(/\\/g, "\\\\")}'
Remove-Item $out,$err,$done -Force -ErrorAction SilentlyContinue
Unblock-File -LiteralPath '${REMOTE_SCRIPT_PATH.replace(/\\/g, "\\\\")}' -ErrorAction SilentlyContinue
$argsList = ${psArgArray}
$p = Start-Process -FilePath powershell.exe -ArgumentList $argsList -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
$code = $p.ExitCode
if ($null -eq $code) { $code = 1 }
if (Test-Path -LiteralPath $err) {
  Add-Content -LiteralPath $out -Value ((Get-Content -LiteralPath $err -Raw -ErrorAction SilentlyContinue))
}
Set-Content -LiteralPath $done -Value $code -Encoding ascii
`.trim();
  const wrapperB64 = Buffer.from(wrapperBody, "utf8").toString("base64");
  return (
    `[IO.File]::WriteAllBytes('${REMOTE_WRAPPER_PATH.replace(/\\/g, "\\\\")}',[Convert]::FromBase64String('${wrapperB64}')); ` +
    `schtasks /Delete /TN HDC-OllamaInstall /F 2>$null | Out-Null; ` +
    `schtasks /Create /TN HDC-OllamaInstall /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${REMOTE_WRAPPER_PATH}" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F | Out-Null; ` +
    `schtasks /Run /TN HDC-OllamaInstall | Out-Null; 'queued'`
  );
}

function buildPollScript() {
  return (
    "$done=Test-Path 'C:\\ProgramData\\HDC\\ollama-install.done'; " +
    "$out=Test-Path 'C:\\ProgramData\\HDC\\ollama-install.out'; " +
    "$code=if($done){(Get-Content 'C:\\ProgramData\\HDC\\ollama-install.done' -Raw).Trim()}else{'na'}; " +
    "$tail=if($out){((Get-Content 'C:\\ProgramData\\HDC\\ollama-install.out' -ErrorAction SilentlyContinue | Select-Object -Last 2) -join ' | ')}else{'na'}; " +
    "if($done){ Write-Output ('DONE:'+$code); Write-Output $tail } else { Write-Output ('RUNNING:'+$tail) }"
  );
}

const REMOTE_PULL_DONE = "C:\\\\ProgramData\\\\HDC\\\\ollama-pull.done";
const REMOTE_PULL_OUT = "C:\\\\ProgramData\\\\HDC\\\\ollama-pull.out";
const REMOTE_PULL_WRAPPER = "C:\\\\ProgramData\\\\HDC\\\\run-ollama-pull.ps1";

/**
 * @param {ReturnType<typeof resolveHostOllamaOpts>} ollama
 */
function buildStartServiceScript(ollama) {
  const serviceName = ollama.serviceName || "Ollama";
  return `
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
}

/**
 * @param {ReturnType<typeof resolveHostOllamaOpts>} ollama
 */
function buildAsyncModelPullScript(ollama) {
  const modelsLiteral = `@(${ollama.models.map((m) => `'${psQuote(m)}'`).join(",")})`;
  const wrapperBody = `
$ErrorActionPreference = 'Stop'
$out = '${REMOTE_PULL_OUT}'
$done = '${REMOTE_PULL_DONE}'
Remove-Item $out,$done -Force -ErrorAction SilentlyContinue
try {
  $exe = Join-Path '${psQuote(ollama.installDir)}' 'ollama.exe'
  Start-Service -Name '${psQuote(ollama.serviceName)}' -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  foreach ($m in ${modelsLiteral}) {
    Write-Output ('pull ' + $m) | Out-File -FilePath $out -Append
    & $exe pull $m
    if ($LASTEXITCODE -ne 0) { throw "pull failed $LASTEXITCODE for $m" }
  }
  '0' | Set-Content -LiteralPath $done -Encoding ascii
} catch {
  $_ | Out-File -FilePath $out -Append
  '1' | Set-Content -LiteralPath $done -Encoding ascii
}
`.trim();
  const wrapperB64 = Buffer.from(wrapperBody, "utf8").toString("base64");
  return (
    `New-Item -ItemType Directory -Force -Path C:\\ProgramData\\HDC | Out-Null; ` +
    `[IO.File]::WriteAllBytes('${REMOTE_PULL_WRAPPER}',[Convert]::FromBase64String('${wrapperB64}')); ` +
    `schtasks /Delete /TN HDC-OllamaPull /F 2>$null | Out-Null; ` +
    `schtasks /Create /TN HDC-OllamaPull /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\ProgramData\\HDC\\run-ollama-pull.ps1" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F | Out-Null; ` +
    `schtasks /Run /TN HDC-OllamaPull | Out-Null; 'queued'`
  );
}

function buildPullPollScript() {
  return (
    "$done=Test-Path 'C:\\ProgramData\\HDC\\ollama-pull.done'; " +
    "$out=Test-Path 'C:\\ProgramData\\HDC\\ollama-pull.out'; " +
    "$code=if($done){(Get-Content 'C:\\ProgramData\\HDC\\ollama-pull.done' -Raw).Trim()}else{'na'}; " +
    "$tail=if($out){((Get-Content 'C:\\ProgramData\\HDC\\ollama-pull.out' -ErrorAction SilentlyContinue | Select-Object -Last 2) -join ' | ')}else{'na'}; " +
    "if($done){ Write-Output ('DONE:'+$code); Write-Output $tail } else { Write-Output ('RUNNING:'+$tail) }"
  );
}

/**
 * @param {import("../../services/meshcentral/lib/meshcentral-api.mjs").MeshcentralApiClient} client
 * @param {string} nodeId
 * @param {(msg: string) => void} [log]
 */
async function pushInstallScriptViaChunks(client, nodeId, log) {
  const script = loadInstallOllamaServiceScript();
  const b64 = Buffer.from(script, "utf8").toString("base64");
  log?.(`pushing Install-OllamaService.ps1 (${b64.length} b64 chars, single write)…`);
  await runOnDevice(
    client,
    nodeId,
    `New-Item -ItemType Directory -Force -Path C:\\ProgramData\\HDC | Out-Null; [IO.File]::WriteAllBytes('C:\\ProgramData\\HDC\\Install-OllamaService.ps1',[Convert]::FromBase64String('${b64}'))`,
    { platform: "windows", reply: false, log, timeoutMs: 15_000 },
  );
  await new Promise((r) => setTimeout(r, 12_000));
  const verify = await runOnDevice(
    client,
    nodeId,
    `if (Test-Path 'C:\\ProgramData\\HDC\\Install-OllamaService.ps1') { 'ok-decoded:' + (Get-Item 'C:\\ProgramData\\HDC\\Install-OllamaService.ps1').Length } else { 'missing' }`,
    { platform: "windows", log, timeoutMs: 90_000 },
  );
  if (!String(verify.output || "").includes("ok-decoded:")) {
    throw new Error(`installer verify failed: ${String(verify.output || "").slice(0, 300)}`);
  }
  log?.(`installer ready: ${String(verify.output || "").trim()}`);
}

/**
 * @param {import("../../services/meshcentral/lib/meshcentral-api.mjs").MeshcentralApiClient} client
 * @param {string} nodeId
 * @param {(msg: string) => void} [log]
 * @param {number} timeoutMs
 */
async function pollAsyncInstall(client, nodeId, log, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const pollScript = buildPollScript();
  while (Date.now() < deadline) {
    try {
      const r = await runOnDevice(client, nodeId, pollScript, {
        platform: "windows",
        log,
        timeoutMs: 90_000,
      });
      const out = String(r.output || "");
      if (out.startsWith("DONE:")) {
        const rest = out.slice("DONE:".length);
        const nl = rest.indexOf("\n");
        const code = nl >= 0 ? rest.slice(0, nl).trim() : rest.trim();
        const body = nl >= 0 ? rest.slice(nl + 1) : "";
        return { ok: true, exitCode: Number(code) || 0, output: body };
      }
      if (out.startsWith("RUNNING:")) {
        const tail = out.slice("RUNNING:".length).trim();
        log?.(tail ? `install running… ${tail.slice(0, 120)}` : "install running…");
      } else {
        log?.(`poll: ${out.slice(0, 120)}`);
      }
    } catch (e) {
      log?.(`poll retry after error: ${String(/** @type {Error} */ (e).message || e).slice(0, 120)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  return { ok: false, exitCode: 1, output: "", message: "timed out waiting for background Ollama install" };
}

/**
 * Install or query Ollama on a Windows host when WinRM is unreachable but MeshCentral agent is online.
 *
 * @param {object} opts
 * @param {string} opts.hostId
 * @param {Record<string, unknown>} opts.host
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.skipModels]
 * @param {boolean} [opts.statusOnly]
 * @param {(msg: string) => void} [opts.log]
 */
export async function runWindowsOllamaViaMeshcentral(opts) {
  const { hostId, host, dryRun = false, skipModels = false, statusOnly = false, log } = opts;
  const ollama = resolveHostOllamaOpts(host);
  const root = repoRoot();
  const clumpRoot = join(root, "clumps", "services", "meshcentral");
  const cfg = loadClumpConfigFromClumpRoot(clumpRoot, {
    exampleRel: "clumps/services/meshcentral/config.example.json",
  }).data;
  const deployments = resolveMeshcentralDeployments(cfg, {});
  const meshcentral = meshcentralFromDeployments(deployments);
  const vault = createPackageVaultAccess();
  const session = await openMeshcentralSession({
    vault,
    meshcentral,
    log: (line) => log?.(line),
  });

  try {
    const { live } = await listNormalizedDevices(session.client, meshcentral);
    const device = live.find(
      (d) => String(d.name ?? "").toLowerCase() === String(hostId).toLowerCase(),
    );
    if (!device?.node_id) {
      return { ok: false, message: `MeshCentral agent not found for host ${hostId}`, via: "meshcentral" };
    }
    if (!device.online) {
      return { ok: false, message: `MeshCentral agent offline for host ${hostId}`, via: "meshcentral" };
    }

    log?.("MeshCentral agent online");

    const presentCheck = await runOnDevice(
      session.client,
      device.node_id,
      `if (Test-Path -LiteralPath 'C:\\ProgramData\\HDC\\Install-OllamaService.ps1') { 'present' } else { 'missing' }`,
      { platform: "windows", log, timeoutMs: 90_000 },
    );
    const scriptPresent = String(presentCheck.output || "").includes("present");
    if (!scriptPresent) {
      await pushInstallScriptViaChunks(session.client, device.node_id, log);
    } else {
      log?.("installer already on disk; skipping push");
    }

    // Short ops stay synchronous.
    if (statusOnly || dryRun) {
      const launcher = buildSyncLauncherScript(ollama, { dryRun, skipModels, statusOnly });
      log?.(statusOnly ? "query Ollama status…" : "dry-run Ollama install…");
      const result = await runOnDevice(session.client, device.node_id, launcher, {
        platform: "windows",
        dryRun,
        log,
        timeoutMs: statusOnly ? 120_000 : 180_000,
      });
      if (!result.ok) {
        return {
          ok: false,
          via: "meshcentral",
          message: result.output?.slice(0, 500) || "MeshCentral runcommands failed",
          stdout: result.output || undefined,
        };
      }
      const parsed = parseJsonTail(result.output);
      if (!parsed) {
        return {
          ok: false,
          via: "meshcentral",
          message: "Ollama script returned no JSON status",
          stdout: result.output || undefined,
        };
      }
      const ok = parsed.ok === true || parsed.ok === "True" || dryRun;
      return {
        ok,
        via: "meshcentral",
        status: parsed,
        message: ok ? undefined : String(parsed.message ?? parsed.service_status ?? "ollama not healthy"),
      };
    }

    // Real install: one-shot schtasks (returns immediately) then poll done marker.
    log?.("queueing background Ollama install via scheduled task…");
    const start = await runOnDevice(
      session.client,
      device.node_id,
      buildAsyncStartScript(ollama, { dryRun, skipModels }),
      { platform: "windows", log, timeoutMs: 90_000 },
    );
    if (!start.ok || !String(start.output || "").includes("queued")) {
      return {
        ok: false,
        via: "meshcentral",
        message: `failed to queue install: ${String(start.output || "").slice(0, 400)}`,
      };
    }
    log?.(`install queued: ${String(start.output || "").trim()}`);

    const polled = await pollAsyncInstall(session.client, device.node_id, log, 3_600_000);
    if (!polled.ok) {
      return {
        ok: false,
        via: "meshcentral",
        message: polled.message || "background install failed",
        stdout: polled.output || undefined,
      };
    }
    const parsed = parseJsonTail(polled.output);
    if (!parsed) {
      return {
        ok: false,
        via: "meshcentral",
        message: `Ollama install finished (exit ${polled.exitCode}) but returned no JSON`,
        stdout: polled.output || undefined,
      };
    }
    const ok =
      (parsed.ok === true || parsed.ok === "True") && Number(polled.exitCode) === 0;
    return {
      ok,
      via: "meshcentral",
      status: parsed,
      message: ok ? undefined : String(parsed.message ?? parsed.service_status ?? "ollama not healthy"),
    };
  } finally {
    await session.client.close();
  }
}

/**
 * @param {object} opts
 * @param {string} opts.hostId
 * @param {Record<string, unknown>} opts.host
 * @param {(msg: string) => void} [opts.log]
 */
export function queryWindowsOllamaViaMeshcentral(opts) {
  return runWindowsOllamaViaMeshcentral({ ...opts, statusOnly: true, skipModels: true });
}

/**
 * @param {object} opts
 * @param {string} opts.hostId
 * @param {Record<string, unknown>} opts.host
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.skipModels]
 * @param {(msg: string) => void} [opts.log]
 */
export function ensureWindowsOllamaViaMeshcentral(opts) {
  return runWindowsOllamaViaMeshcentral({ ...opts, statusOnly: false });
}

/**
 * @param {object} opts
 * @param {string} opts.hostId
 * @param {Record<string, unknown>} opts.host
 * @param {(msg: string) => void} [opts.log]
 */
export async function startWindowsOllamaViaMeshcentral(opts) {
  const { hostId, host, log } = opts;
  const ollama = resolveHostOllamaOpts(host);
  const root = repoRoot();
  const clumpRoot = join(root, "clumps", "services", "meshcentral");
  const cfg = loadClumpConfigFromClumpRoot(clumpRoot, {
    exampleRel: "clumps/services/meshcentral/config.example.json",
  }).data;
  const deployments = resolveMeshcentralDeployments(cfg, {});
  const meshcentral = meshcentralFromDeployments(deployments);
  const vault = createPackageVaultAccess();
  const session = await openMeshcentralSession({
    vault,
    meshcentral,
    log: (line) => log?.(line),
  });
  try {
    const { live } = await listNormalizedDevices(session.client, meshcentral);
    const device = live.find(
      (d) => String(d.name ?? "").toLowerCase() === String(hostId).toLowerCase(),
    );
    if (!device?.node_id) {
      return { ok: false, message: `MeshCentral agent not found for host ${hostId}`, via: "meshcentral" };
    }
    if (!device.online) {
      return { ok: false, message: `MeshCentral agent offline for host ${hostId}`, via: "meshcentral" };
    }
    log?.("start Ollama service via MeshCentral…");
    const result = await runOnDevice(session.client, device.node_id, buildStartServiceScript(ollama), {
      platform: "windows",
      log,
      timeoutMs: 120_000,
    });
    const parsed = parseJsonTail(result.output);
    if (!result.ok || !parsed) {
      return {
        ok: false,
        via: "meshcentral",
        message: result.output?.slice(0, 500) || "Ollama start failed",
        stdout: result.output || undefined,
      };
    }
    const ok = parsed.ok === true || parsed.ok === "True";
    return {
      ok,
      via: "meshcentral",
      status: parsed,
      message: ok ? undefined : String(parsed.service_status ?? "ollama not running"),
    };
  } finally {
    await session.client.close();
  }
}

/**
 * Queue model pulls via schtasks and poll done marker (MeshCentral).
 * @param {object} opts
 * @param {string} opts.hostId
 * @param {Record<string, unknown>} opts.host
 * @param {boolean} [opts.dryRun]
 * @param {(msg: string) => void} [opts.log]
 */
export async function pullWindowsOllamaModelsViaMeshcentral(opts) {
  const { hostId, host, dryRun = false, log } = opts;
  const ollama = resolveHostOllamaOpts(host);
  if (!ollama.models.length) {
    return { ok: false, message: "no models configured for this host", via: "meshcentral" };
  }
  if (dryRun) {
    return { ok: true, dry_run: true, via: "meshcentral", status: { models: ollama.models } };
  }
  const root = repoRoot();
  const clumpRoot = join(root, "clumps", "services", "meshcentral");
  const cfg = loadClumpConfigFromClumpRoot(clumpRoot, {
    exampleRel: "clumps/services/meshcentral/config.example.json",
  }).data;
  const deployments = resolveMeshcentralDeployments(cfg, {});
  const meshcentral = meshcentralFromDeployments(deployments);
  const vault = createPackageVaultAccess();
  const session = await openMeshcentralSession({
    vault,
    meshcentral,
    log: (line) => log?.(line),
  });
  try {
    const { live } = await listNormalizedDevices(session.client, meshcentral);
    const device = live.find(
      (d) => String(d.name ?? "").toLowerCase() === String(hostId).toLowerCase(),
    );
    if (!device?.node_id) {
      return { ok: false, message: `MeshCentral agent not found for host ${hostId}`, via: "meshcentral" };
    }
    if (!device.online) {
      return { ok: false, message: `MeshCentral agent offline for host ${hostId}`, via: "meshcentral" };
    }
    log?.(`queueing model pull (${ollama.models.length}) via MeshCentral…`);
    const start = await runOnDevice(session.client, device.node_id, buildAsyncModelPullScript(ollama), {
      platform: "windows",
      log,
      timeoutMs: 90_000,
    });
    if (!start.ok || !String(start.output || "").includes("queued")) {
      return {
        ok: false,
        via: "meshcentral",
        message: `failed to queue model pull: ${String(start.output || "").slice(0, 400)}`,
      };
    }
    const deadline = Date.now() + 3_600_000;
    const pollScript = buildPullPollScript();
    while (Date.now() < deadline) {
      const r = await runOnDevice(session.client, device.node_id, pollScript, {
        platform: "windows",
        log,
        timeoutMs: 90_000,
      });
      const out = String(r.output || "");
      if (out.startsWith("DONE:")) {
        const rest = out.slice("DONE:".length);
        const nl = rest.indexOf("\n");
        const code = Number((nl >= 0 ? rest.slice(0, nl) : rest).trim()) || 0;
        return {
          ok: code === 0,
          via: "meshcentral",
          status: { exit_code: code, models: ollama.models },
          message: code === 0 ? undefined : "model pull failed",
        };
      }
      log?.(out.startsWith("RUNNING:") ? `pull running… ${out.slice(8).trim().slice(0, 120)}` : `pull poll: ${out.slice(0, 120)}`);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    return { ok: false, via: "meshcentral", message: "timed out waiting for model pull" };
  } finally {
    await session.client.close();
  }
}
