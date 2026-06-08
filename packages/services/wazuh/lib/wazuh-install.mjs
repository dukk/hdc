import { stderr as errout } from "node:process";

import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { waitForCt } from "../../ollama/lib/ollama-install.mjs";
import { resolvePveSshForHost } from "../../pi-hole/lib/pi-hole-install.mjs";
import {
  buildOfficialStackInstallScript,
  composeDir,
  renderWazuhEnv,
  resolveDashboardUrl,
  wazuhDockerRelease,
  wazuhStackDir,
} from "./wazuh-render.mjs";
import { wazuhDashboardPort } from "./deployments.mjs";

export { resolvePveSshForHost };

/**
 * @typedef {{ run: (script: string) => { status: number; stdout: string; stderr: string }; label?: string }} GuestExec
 */

/**
 * @param {string} s
 */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {Record<string, unknown>} wazuh
 * @param {Record<string, unknown>} install
 * @param {string} apiPassword
 * @param {string} agentPassword
 */
export function buildInstallScript(wazuh, install, apiPassword, agentPassword) {
  const release = wazuhDockerRelease(wazuh);
  const dashboardPort = wazuhDashboardPort(wazuh);
  const root = composeDir(install).replace(/'/g, `'\\''`);
  const script = buildOfficialStackInstallScript(release, apiPassword, agentPassword, dashboardPort).replace(
    `export WAZUH_ROOT='${composeDir({}).replace(/'/g, `'\\''`)}'`,
    `export WAZUH_ROOT='${root}'`,
  );
  const envContent = renderWazuhEnv(wazuh, apiPassword, agentPassword);
  return [
    script,
    `cat > '${root}/.env' <<'HDCENV'`,
    envContent.trimEnd(),
    "HDCENV",
  ].join("\n");
}

/**
 * @param {string} composeDirPath
 * @param {string} envContent
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export function buildMaintainScript(install, envContent, opts = {}) {
  const stack = wazuhStackDir(install).replace(/'/g, `'\\''`);
  const root = composeDir(install).replace(/'/g, `'\\''`);
  const lines = [
    "set -euo pipefail",
    `mkdir -p '${root}'`,
    `test -f '${stack}/docker-compose.yml'`,
    `cat > '${root}/.env' <<'HDCENV'`,
    envContent.trimEnd(),
    "HDCENV",
    `cd '${stack}'`,
  ];
  if (!opts.skipUpgrade) lines.push("docker compose pull");
  lines.push("docker compose up -d", "docker compose ps");
  return lines.join("\n");
}

/**
 * @param {string} composeDirPath
 */
export function buildComposeDownScript(install) {
  const stack = wazuhStackDir(install).replace(/'/g, `'\\''`);
  return [
    "set -euo pipefail",
    `if test -f '${stack}/docker-compose.yml'; then`,
    `  cd '${stack}' && docker compose down -v 2>/dev/null || true`,
    "fi",
  ].join("\n");
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 */
export function readCtPrimaryIp(user, pveHost, vmid) {
  const r = pctExec(user, pveHost, vmid, "hostname -I | awk '{print $1}'", { capture: true });
  if (r.status !== 0) return null;
  const ip = r.stdout.trim().split(/\s+/)[0];
  return ip || null;
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} wazuh
 * @param {Record<string, unknown>} install
 * @param {string} apiPassword
 * @param {string} agentPassword
 */
export async function installWazuhInCt(user, pveHost, vmid, wazuh, install, apiPassword, agentPassword) {
  errout.write(`[hdc] wazuh install: Docker Compose in CT ${vmid} ...\n`);
  const ready = await waitForCt(user, pveHost, vmid, 2000, "wazuh install");
  if (!ready) {
    return { ok: false, method: "docker-compose", message: `CT ${vmid} not reachable via pct exec` };
  }
  const inner = buildInstallScript(wazuh, install, apiPassword, agentPassword);
  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return { ok: false, method: "docker-compose", message: `install failed (exit ${r.status})` };
  }
  const ip = readCtPrimaryIp(user, pveHost, vmid);
  return { ok: true, method: "docker-compose", message: "installed", dashboard_url: resolveDashboardUrl(wazuh, ip) };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} wazuh
 * @param {Record<string, unknown>} install
 * @param {string} apiPassword
 * @param {string} agentPassword
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export async function maintainWazuhInCt(
  user,
  pveHost,
  vmid,
  wazuh,
  install,
  apiPassword,
  agentPassword,
  opts = {},
) {
  errout.write(`[hdc] wazuh maintain: refreshing stack in CT ${vmid} ...\n`);
  const ready = await waitForCt(user, pveHost, vmid, 2000, "wazuh maintain");
  if (!ready) return { ok: false, message: `CT ${vmid} not reachable via pct exec` };
  const envContent = renderWazuhEnv(wazuh, apiPassword, agentPassword);
  const inner = buildMaintainScript(install, envContent, opts);
  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) return { ok: false, message: `maintain failed (exit ${r.status})` };
  return { ok: true, message: "images refreshed" };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} install
 */
export function composeDownInCt(user, pveHost, vmid, install) {
  const inner = buildComposeDownScript(install);
  pctExec(user, pveHost, vmid, inner);
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} wazuh
 * @param {Record<string, unknown>} install
 */
/**
 * @param {GuestExec} exec
 * @param {Record<string, unknown>} wazuh
 * @param {Record<string, unknown>} install
 * @param {string} apiPassword
 * @param {string} agentPassword
 */
export async function installWazuhOnHost(exec, wazuh, install, apiPassword, agentPassword) {
  errout.write(`[hdc] wazuh install: Docker Compose via ${exec.label ?? "ssh"} …\n`);
  const inner = buildInstallScript(wazuh, install, apiPassword, agentPassword);
  const r = exec.run(inner);
  if (r.status !== 0) {
    return {
      ok: false,
      method: "docker-compose",
      message: `install failed (exit ${r.status})`,
      detail: `${r.stderr}${r.stdout}`.trim() || null,
    };
  }
  const ipOut = exec.run("hostname -I | awk '{print $1}'");
  const ip = ipOut.status === 0 ? ipOut.stdout.trim().split(/\s+/)[0] || null : null;
  return { ok: true, method: "docker-compose", message: "installed", dashboard_url: resolveDashboardUrl(wazuh, ip) };
}

/**
 * @param {GuestExec} exec
 * @param {Record<string, unknown>} wazuh
 * @param {Record<string, unknown>} install
 * @param {string} apiPassword
 * @param {string} agentPassword
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export async function maintainWazuhOnHost(
  exec,
  wazuh,
  install,
  apiPassword,
  agentPassword,
  opts = {},
) {
  errout.write(`[hdc] wazuh maintain: refreshing stack via ${exec.label ?? "ssh"} …\n`);
  const envContent = renderWazuhEnv(wazuh, apiPassword, agentPassword);
  const inner = buildMaintainScript(install, envContent, opts);
  const r = exec.run(inner);
  if (r.status !== 0) return { ok: false, message: `maintain failed (exit ${r.status})` };
  return { ok: true, message: opts.skipUpgrade ? "restarted" : "images refreshed" };
}

/**
 * @param {GuestExec} exec
 * @param {Record<string, unknown>} install
 */
export function composeDownOnHost(exec, install) {
  const inner = buildComposeDownScript(install);
  exec.run(inner);
}

/**
 * @param {GuestExec} exec
 * @param {Record<string, unknown>} wazuh
 * @param {Record<string, unknown>} install
 * @param {number | null} [vmid]
 */
export function queryWazuhOnHost(exec, wazuh, install, vmid = null) {
  const dir = wazuhStackDir(install);
  const dashboardPort = wazuhDashboardPort(wazuh);
  const cap = { capture: true };
  const docker = exec.run("systemctl is-active docker 2>/dev/null || echo inactive", cap);
  const composePs = exec.run(
    `test -d ${shellQuote(dir)} && cd ${shellQuote(dir)} && docker compose ps --format json 2>/dev/null || docker compose ps 2>/dev/null || echo '[]'`,
    cap,
  );
  const ipOut = exec.run("hostname -I | awk '{print $1}'", cap);
  const ip = ipOut.status === 0 ? ipOut.stdout.trim().split(/\s+/)[0] || null : null;
  const health = exec.run(
    `curl -skf --max-time 8 https://127.0.0.1:${dashboardPort}/ -o /dev/null && echo ok || echo fail`,
    cap,
  );
  return {
    vmid,
    docker_active: docker.stdout.trim(),
    compose_ps: composePs.stdout.trim() || null,
    guest_ip: ip,
    ct_ip: ip,
    dashboard_port: dashboardPort,
    dashboard_url: resolveDashboardUrl(wazuh, ip),
    dashboard_ok: health.stdout.trim() === "ok",
  };
}

export function queryWazuhInCt(user, pveHost, vmid, wazuh, install) {
  const dir = wazuhStackDir(install);
  const dashboardPort = wazuhDashboardPort(wazuh);
  const docker = pctExec(user, pveHost, vmid, "systemctl is-active docker 2>/dev/null || echo inactive", {
    capture: true,
  });
  const composePs = pctExec(
    user,
    pveHost,
    vmid,
    `test -d ${shellQuote(dir)} && cd ${shellQuote(dir)} && docker compose ps --format json 2>/dev/null || docker compose ps 2>/dev/null || echo '[]'`,
    { capture: true },
  );
  const ip = readCtPrimaryIp(user, pveHost, vmid);
  const health = pctExec(
    user,
    pveHost,
    vmid,
    `curl -skf --max-time 8 https://127.0.0.1:${dashboardPort}/ -o /dev/null && echo ok || echo fail`,
    { capture: true },
  );
  return {
    vmid,
    docker_active: docker.stdout.trim(),
    compose_ps: composePs.stdout.trim() || null,
    ct_ip: ip,
    guest_ip: ip,
    dashboard_port: dashboardPort,
    dashboard_url: resolveDashboardUrl(wazuh, ip),
    dashboard_ok: health.stdout.trim() === "ok",
  };
}
