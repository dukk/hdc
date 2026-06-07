import { stderr as errout } from "node:process";

import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { waitForCt } from "../../ollama/lib/ollama-install.mjs";
import { resolvePveSshForHost } from "../../pi-hole/lib/pi-hole-install.mjs";
import { composeDir, renderComposeYaml, renderWazuhEnv, resolveDashboardUrl } from "./wazuh-render.mjs";
import { wazuhDashboardPort } from "./deployments.mjs";

export { resolvePveSshForHost };

/**
 * @param {string} s
 */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string} composeDirPath
 * @param {string} composeYaml
 * @param {string} envContent
 */
export function buildInstallScript(composeDirPath, composeYaml, envContent) {
  const dir = composeDirPath.replace(/'/g, `'\\''`);
  return [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq ca-certificates curl gnupg",
    "if ! command -v docker >/dev/null 2>&1; then",
    "  install -m 0755 -d /etc/apt/keyrings",
    "  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc",
    "  chmod a+r /etc/apt/keyrings/docker.asc",
    '  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${VERSION_CODENAME:-$VERSION_ID}) stable" > /etc/apt/sources.list.d/docker.list',
    "  apt-get update -qq",
    "  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin",
    "fi",
    "systemctl enable --now docker",
    `mkdir -p '${dir}'`,
    `cat > '${dir}/docker-compose.yml' <<'HDCOMPOSE'`,
    composeYaml.trimEnd(),
    "HDCOMPOSE",
    `cat > '${dir}/.env' <<'HDCENV'`,
    envContent.trimEnd(),
    "HDCENV",
    `cd '${dir}'`,
    "docker compose pull",
    "docker compose up -d",
    "docker compose ps",
  ].join("\n");
}

/**
 * @param {string} composeDirPath
 * @param {string} envContent
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export function buildMaintainScript(composeDirPath, envContent, opts = {}) {
  const dir = composeDirPath.replace(/'/g, `'\\''`);
  const lines = [
    "set -euo pipefail",
    `mkdir -p '${dir}'`,
    `test -f '${dir}/docker-compose.yml'`,
    `cat > '${dir}/.env' <<'HDCENV'`,
    envContent.trimEnd(),
    "HDCENV",
    `cd '${dir}'`,
  ];
  if (!opts.skipUpgrade) lines.push("docker compose pull");
  lines.push("docker compose up -d", "docker compose ps");
  return lines.join("\n");
}

/**
 * @param {string} composeDirPath
 */
export function buildComposeDownScript(composeDirPath) {
  const dir = composeDirPath.replace(/'/g, `'\\''`);
  return [
    "set -euo pipefail",
    `if test -f '${dir}/docker-compose.yml'; then`,
    `  cd '${dir}' && docker compose down -v 2>/dev/null || true`,
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
  const envContent = renderWazuhEnv(wazuh, apiPassword, agentPassword);
  const composeYaml = renderComposeYaml();
  const dir = composeDir(install);
  const inner = buildInstallScript(dir, composeYaml, envContent);
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
  const dir = composeDir(install);
  const inner = buildMaintainScript(dir, envContent, opts);
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
  const dir = composeDir(install);
  const inner = buildComposeDownScript(dir);
  pctExec(user, pveHost, vmid, inner);
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} wazuh
 * @param {Record<string, unknown>} install
 */
export function queryWazuhInCt(user, pveHost, vmid, wazuh, install) {
  const dir = composeDir(install);
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
    dashboard_port: dashboardPort,
    dashboard_url: resolveDashboardUrl(wazuh, ip),
    dashboard_ok: health.stdout.trim() === "ok",
  };
}
