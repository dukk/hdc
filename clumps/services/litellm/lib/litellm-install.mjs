import { stderr as errout } from "node:process";

import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { waitForCt } from "../../ollama/lib/ollama-install.mjs";
import { resolvePveSshForHost } from "../../pi-hole/lib/pi-hole-install.mjs";
import { renderLitellmConfigYaml } from "./litellm-config-render.mjs";
import {
  composeDir,
  renderComposeYaml,
  renderLitellmEnv,
  resolveApiUrl,
  resolveUiUrl,
  resolveUpstreamUrl,
} from "./litellm-render.mjs";

export { resolvePveSshForHost };

/**
 * @param {string} composeDirPath
 * @param {string} composeYaml
 * @param {string} envContent
 * @param {string} configYaml
 */
export function buildInstallScript(composeDirPath, composeYaml, envContent, configYaml) {
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
    `cat > '${dir}/config.yaml' <<'HDCCONFIG'`,
    configYaml.trimEnd(),
    "HDCCONFIG",
    `cat > '${dir}/.env' <<'HDCENV'`,
    envContent.trimEnd(),
    "HDCENV",
    `chmod 600 '${dir}/.env' '${dir}/config.yaml'`,
    `cd '${dir}'`,
    "docker compose pull",
    "docker compose up -d",
    "docker compose ps",
  ].join("\n");
}

/**
 * @param {string} composeDirPath
 * @param {string} envContent
 * @param {string} configYaml
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export function buildMaintainScript(composeDirPath, envContent, configYaml, opts = {}) {
  const dir = composeDirPath.replace(/'/g, `'\\''`);
  const lines = [
    "set -euo pipefail",
    `mkdir -p '${dir}'`,
    `test -f '${dir}/docker-compose.yml'`,
    `cat > '${dir}/config.yaml' <<'HDCCONFIG'`,
    configYaml.trimEnd(),
    "HDCCONFIG",
    `cat > '${dir}/.env' <<'HDCENV'`,
    envContent.trimEnd(),
    "HDCENV",
    `chmod 600 '${dir}/.env' '${dir}/config.yaml'`,
    `cd '${dir}'`,
  ];
  if (!opts.skipUpgrade) {
    lines.push("docker compose pull");
  }
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
 * @param {Record<string, unknown>} litellm
 * @param {{ masterKey: string; saltKey: string; dbPassword: string; openrouterApiKey?: string | null }} secrets
 */
function renderStackFiles(litellm, secrets) {
  const envContent = renderLitellmEnv(litellm, secrets);
  const configYaml = renderLitellmConfigYaml(litellm);
  const composeYaml = renderComposeYaml();
  return { envContent, configYaml, composeYaml };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} litellm
 * @param {Record<string, unknown>} install
 * @param {{ masterKey: string; saltKey: string; dbPassword: string; openrouterApiKey?: string | null }} secrets
 */
export async function installLitellmInCt(user, pveHost, vmid, litellm, install, secrets) {
  errout.write(`[hdc] litellm install: Docker Compose in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, "litellm install");
  if (!ready) {
    return { ok: false, method: "docker-compose", message: `CT ${vmid} not reachable via pct exec` };
  }

  const ip = readCtPrimaryIp(user, pveHost, vmid);
  const { envContent, configYaml, composeYaml } = renderStackFiles(litellm, secrets);
  const dir = composeDir(install);
  const inner = buildInstallScript(dir, composeYaml, envContent, configYaml);

  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return {
      ok: false,
      method: "docker-compose",
      message: `install failed (exit ${r.status})`,
    };
  }

  errout.write(`[hdc] litellm install: completed on CT ${vmid}.\n`);
  return {
    ok: true,
    method: "docker-compose",
    message: "installed",
    api_url: resolveApiUrl(litellm, ip),
    ui_url: resolveUiUrl(litellm, ip),
    upstream_url: resolveUpstreamUrl(ip, litellm),
    ct_ip: ip,
  };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} litellm
 * @param {Record<string, unknown>} install
 * @param {{ masterKey: string; saltKey: string; dbPassword: string; openrouterApiKey?: string | null }} secrets
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export async function maintainLitellmInCt(user, pveHost, vmid, litellm, install, secrets, opts = {}) {
  errout.write(`[hdc] litellm maintain: refreshing stack in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, "litellm maintain");
  if (!ready) {
    return { ok: false, message: `CT ${vmid} not reachable via pct exec` };
  }

  const ip = readCtPrimaryIp(user, pveHost, vmid);
  const { envContent, configYaml } = renderStackFiles(litellm, secrets);
  const dir = composeDir(install);
  const inner = buildMaintainScript(dir, envContent, configYaml, opts);
  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return { ok: false, message: `maintain failed (exit ${r.status})` };
  }
  return {
    ok: true,
    message: opts.skipUpgrade ? "restarted" : "images refreshed",
    api_url: resolveApiUrl(litellm, ip),
    ui_url: resolveUiUrl(litellm, ip),
    upstream_url: resolveUpstreamUrl(ip, litellm),
    ct_ip: ip,
  };
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
