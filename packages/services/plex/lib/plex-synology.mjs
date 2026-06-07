import { join } from "node:path";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { createSynologyExecContext } from "../../../infrastructure/synology-nas/lib/synology-exec-context.mjs";
import { synologyRemoteExec } from "../../../infrastructure/synology-nas/lib/synology-ssh.mjs";
import { packageNameFromPlex, portFromPlex, resolveUiUrl } from "./plex-render.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} packageName
 */
function shellQuote(packageName) {
  return packageName.replace(/'/g, `'\\''`);
}

/**
 * @param {string} output
 */
export function parseSynopkgStatus(output) {
  const text = output.trim().toLowerCase();
  if (!text || /not installed|package .* not found|can't find|cannot find/i.test(text)) {
    return { installed: false, running: false, raw: output.trim() };
  }
  const running = /\b(started|running)\b/.test(text);
  const stopped = /\b(stopped|stop)\b/.test(text) && !running;
  return {
    installed: true,
    running,
    stopped,
    raw: output.trim(),
  };
}

/**
 * @param {ReturnType<import("./deployments.mjs").finalizeDeployment>} deployment
 * @param {{ readLineQuestion?: (q: string, o?: { mask?: boolean }) => Promise<string>; warn?: (s: string) => void; log?: (s: string) => void }} [deps]
 */
export async function loadPlexSynologyContext(deployment, deps = {}) {
  const root = repoRoot();
  const synologyRoot = join(root, "packages", "infrastructure", "synology-nas");
  const loaded = loadPackageConfigFromPackageRoot(synologyRoot, {
    exampleRel: "packages/infrastructure/synology-nas/config.example.json",
  });
  const syn = deployment.synology;
  const instance =
    isObject(syn) && typeof syn.instance === "string" && syn.instance.trim()
      ? syn.instance.trim()
      : "a";
  const ctx = await createSynologyExecContext({
    cfg: loaded.data,
    flags: { instance },
    deps,
  });
  return { synologyCfg: loaded.data, ...ctx };
}

/**
 * @param {object} execOpts
 * @param {string} packageName
 */
function synopkgStatus(execOpts, packageName) {
  const q = shellQuote(packageName);
  return synologyRemoteExec(execOpts, `/usr/syno/bin/synopkg status '${q}' 2>&1`);
}

/**
 * @param {object} execOpts
 * @param {string} packageName
 */
function synopkgStart(execOpts, packageName) {
  const q = shellQuote(packageName);
  return synologyRemoteExec(execOpts, `/usr/syno/bin/synopkg start '${q}' 2>&1`);
}

/**
 * @param {object} execOpts
 * @param {string} packageName
 */
function synopkgUpgrade(execOpts, packageName) {
  const q = shellQuote(packageName);
  return synologyRemoteExec(
    { ...execOpts, timeoutMs: 900_000 },
    `/usr/syno/bin/synopkg upgrade '${q}' 2>&1`,
  );
}

/**
 * @param {object} execOpts
 * @param {string} packageName
 */
function synopkgStop(execOpts, packageName) {
  const q = shellQuote(packageName);
  return synologyRemoteExec(execOpts, `/usr/syno/bin/synopkg stop '${q}' 2>&1`);
}

/**
 * @param {object} execOpts
 * @param {string} packageName
 */
function synopkgVersion(execOpts, packageName) {
  const q = shellQuote(packageName);
  return synologyRemoteExec(execOpts, `/usr/syno/bin/synopkg version '${q}' 2>&1`);
}

/**
 * @param {object} execOpts
 * @param {number} port
 */
function probePlexHttp(execOpts, port) {
  const healthCmd = `curl -sf --max-time 10 http://127.0.0.1:${port}/identity -o /dev/null && echo ok || echo fail`;
  return synologyRemoteExec(execOpts, healthCmd);
}

/**
 * @param {ReturnType<import("./deployments.mjs").finalizeDeployment>} deployment
 * @param {{ readLineQuestion?: (q: string, o?: { mask?: boolean }) => Promise<string>; warn?: (s: string) => void; log?: (s: string) => void }} [deps]
 */
export async function queryPlexOnSynology(deployment, deps = {}) {
  const { execOpts, target } = await loadPlexSynologyContext(deployment, deps);
  const packageName = packageNameFromPlex(deployment.plex);
  const port = portFromPlex(deployment.plex);

  const statusRes = synopkgStatus(execOpts, packageName);
  const status = parseSynopkgStatus(`${statusRes.stdout}\n${statusRes.stderr}`);
  const versionRes = synopkgVersion(execOpts, packageName);
  const version =
    versionRes.status === 0 ? versionRes.stdout.trim() || null : `${versionRes.stderr}${versionRes.stdout}`.trim() || null;

  let httpOk = null;
  let httpError = null;
  if (status.installed && status.running) {
    const h = probePlexHttp(execOpts, port);
    if (h.status === 0 && h.stdout.trim() === "ok") {
      httpOk = true;
    } else {
      httpOk = false;
      httpError = `${h.stderr}${h.stdout}`.trim() || `exit ${h.status}`;
    }
  }

  return {
    package_name: packageName,
    package_installed: status.installed,
    package_running: status.running,
    package_status: status.raw || null,
    package_version: version,
    host: target.host,
    http_ok: httpOk,
    http_error: httpError,
    port,
    ui_url: resolveUiUrl(deployment.plex, target.host),
  };
}

/**
 * @param {ReturnType<import("./deployments.mjs").finalizeDeployment>} deployment
 * @param {{ readLineQuestion?: (q: string, o?: { mask?: boolean }) => Promise<string>; warn?: (s: string) => void; log?: (s: string) => void }} [deps]
 */
export async function deployPlexOnSynology(deployment, deps = {}) {
  const { execOpts, target, log } = await loadPlexSynologyContext(deployment, deps);
  const packageName = packageNameFromPlex(deployment.plex);
  const port = portFromPlex(deployment.plex);

  if (deployment.install.enabled === false) {
    errout.write(`[hdc] plex synology: ${deployment.systemId} install disabled — adopt existing package.\n`);
  } else {
    errout.write(
      `[hdc] plex synology: install.enabled is true but SPK install is not automated — install ${packageName} manually in DSM first.\n`,
    );
  }

  const statusRes = synopkgStatus(execOpts, packageName);
  const status = parseSynopkgStatus(`${statusRes.stdout}\n${statusRes.stderr}`);
  if (!status.installed) {
    return {
      ok: false,
      skipped: false,
      message: `${packageName} is not installed on ${target.host} — install via DSM Package Center or manual .spk`,
      package_status: status.raw,
      host: target.host,
    };
  }

  if (!status.running) {
    log(`starting ${packageName} …`);
    const startRes = synopkgStart(execOpts, packageName);
    const startOut = `${startRes.stdout}\n${startRes.stderr}`.trim();
    if (startRes.status !== 0) {
      return {
        ok: false,
        message: `synopkg start failed: ${startOut || `exit ${startRes.status}`}`,
        host: target.host,
      };
    }
  }

  const afterStart = synopkgStatus(execOpts, packageName);
  const live = parseSynopkgStatus(`${afterStart.stdout}\n${afterStart.stderr}`);
  const h = probePlexHttp(execOpts, port);
  const httpOk = h.status === 0 && h.stdout.trim() === "ok";

  return {
    ok: live.running && httpOk,
    skipped: deployment.install.enabled === false,
    package_running: live.running,
    http_ok: httpOk,
    host: target.host,
    ui_url: resolveUiUrl(deployment.plex, target.host),
    message: httpOk ? null : `Plex HTTP probe failed on port ${port}`,
  };
}

/**
 * @param {ReturnType<import("./deployments.mjs").finalizeDeployment>} deployment
 * @param {{ skipUpgrade?: boolean }} [opts]
 * @param {{ readLineQuestion?: (q: string, o?: { mask?: boolean }) => Promise<string>; warn?: (s: string) => void; log?: (s: string) => void }} [deps]
 */
export async function maintainPlexOnSynology(deployment, opts = {}, deps = {}) {
  const { execOpts, target, log } = await loadPlexSynologyContext(deployment, deps);
  const packageName = packageNameFromPlex(deployment.plex);
  const port = portFromPlex(deployment.plex);

  const statusRes = synopkgStatus(execOpts, packageName);
  const status = parseSynopkgStatus(`${statusRes.stdout}\n${statusRes.stderr}`);
  if (!status.installed) {
    return {
      ok: false,
      message: `${packageName} is not installed on ${target.host}`,
      host: target.host,
    };
  }

  if (!status.running) {
    log(`starting ${packageName} …`);
    const startRes = synopkgStart(execOpts, packageName);
    if (startRes.status !== 0) {
      const detail = `${startRes.stderr}${startRes.stdout}`.trim() || `exit ${startRes.status}`;
      return { ok: false, message: `synopkg start failed: ${detail}`, host: target.host };
    }
  }

  /** @type {string | null} */
  let upgradeOutput = null;
  if (!opts.skipUpgrade) {
    log(`upgrading ${packageName} …`);
    const up = synopkgUpgrade(execOpts, packageName);
    upgradeOutput = `${up.stdout}\n${up.stderr}`.trim().slice(0, 2000);
    if (up.status !== 0) {
      return {
        ok: false,
        message: `synopkg upgrade failed: ${upgradeOutput || `exit ${up.status}`}`,
        host: target.host,
        upgrade_output: upgradeOutput,
      };
    }
  }

  const h = probePlexHttp(execOpts, port);
  const httpOk = h.status === 0 && h.stdout.trim() === "ok";

  return {
    ok: httpOk,
    skip_upgrade: opts.skipUpgrade === true,
    upgrade_output: upgradeOutput,
    http_ok: httpOk,
    host: target.host,
    ui_url: resolveUiUrl(deployment.plex, target.host),
    message: httpOk ? null : `Plex HTTP probe failed on port ${port}`,
  };
}

/**
 * @param {ReturnType<import("./deployments.mjs").finalizeDeployment>} deployment
 * @param {{ readLineQuestion?: (q: string, o?: { mask?: boolean }) => Promise<string>; warn?: (s: string) => void; log?: (s: string) => void }} [deps]
 */
export async function teardownPlexOnSynology(deployment, deps = {}) {
  const { execOpts, target, log } = await loadPlexSynologyContext(deployment, deps);
  const packageName = packageNameFromPlex(deployment.plex);

  log(`stopping ${packageName} (package remains installed) …`);
  const stopRes = synopkgStop(execOpts, packageName);
  const stopOut = `${stopRes.stdout}\n${stopRes.stderr}`.trim();
  const ok = stopRes.status === 0;

  return {
    ok,
    uninstalled: false,
    host: target.host,
    message: ok ? null : `synopkg stop failed: ${stopOut || `exit ${stopRes.status}`}`,
    stop_output: stopOut.slice(0, 1500),
  };
}
