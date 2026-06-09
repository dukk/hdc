import { stderr as errout } from "node:process";

import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { waitForCt } from "../../ollama/lib/ollama-install.mjs";
import { resolvePveSshForHost } from "../../pi-hole/lib/pi-hole-install.mjs";
import { loadHomepageConfigFiles } from "./homepage-config-load.mjs";
import {
  composeDir,
  renderComposeYaml,
  renderHomepageEnv,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "./homepage-render.mjs";
import { resolveHomepageProxmoxWidgetEnv } from "./homepage-proxmox-widget.mjs";

export { resolvePveSshForHost };

/**
 * @param {string} dir
 * @param {string} relPath
 * @param {string} content
 */
function writeConfigFileHerdoc(dir, relPath, content) {
  const full = `${dir}/${relPath}`.replace(/'/g, `'\\''`);
  const marker = `HDC${relPath.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
  return [
    `mkdir -p '${dir}/config'`,
    `cat > '${full}' <<'${marker}'`,
    content.trimEnd(),
    marker,
  ];
}

/**
 * @param {string} composeDirPath
 * @param {string} composeYaml
 * @param {string} envContent
 * @param {{ servicesYaml: string; settingsYaml: string; bookmarksYaml: string; widgetsYaml?: string }} configFiles
 */
export function buildInstallScript(composeDirPath, composeYaml, envContent, configFiles) {
  const dir = composeDirPath.replace(/'/g, `'\\''`);
  /** @type {string[]} */
  const configWrites = [
    ...writeConfigFileHerdoc(dir, "config/services.yaml", configFiles.servicesYaml),
    ...writeConfigFileHerdoc(dir, "config/settings.yaml", configFiles.settingsYaml),
    ...writeConfigFileHerdoc(dir, "config/bookmarks.yaml", configFiles.bookmarksYaml),
  ];
  if (configFiles.widgetsYaml) {
    configWrites.push(...writeConfigFileHerdoc(dir, "config/widgets.yaml", configFiles.widgetsYaml));
  }

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
    ...configWrites,
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
 * @param {{ servicesYaml: string; settingsYaml: string; bookmarksYaml: string; widgetsYaml?: string }} configFiles
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export function buildMaintainScript(composeDirPath, envContent, configFiles, composeYaml, opts = {}) {
  const dir = composeDirPath.replace(/'/g, `'\\''`);
  /** @type {string[]} */
  const configWrites = [
    ...writeConfigFileHerdoc(dir, "config/services.yaml", configFiles.servicesYaml),
    ...writeConfigFileHerdoc(dir, "config/settings.yaml", configFiles.settingsYaml),
    ...writeConfigFileHerdoc(dir, "config/bookmarks.yaml", configFiles.bookmarksYaml),
  ];
  if (configFiles.widgetsYaml) {
    configWrites.push(...writeConfigFileHerdoc(dir, "config/widgets.yaml", configFiles.widgetsYaml));
  }
  const lines = [
    "set -euo pipefail",
    `mkdir -p '${dir}'`,
    ...configWrites,
    `cat > '${dir}/docker-compose.yml' <<'HDCOMPOSE'`,
    composeYaml.trimEnd(),
    "HDCOMPOSE",
    `cat > '${dir}/.env' <<'HDCENV'`,
    envContent.trimEnd(),
    "HDCENV",
    `cd '${dir}'`,
  ];
  if (!opts.skipUpgrade) {
    lines.push("docker compose pull");
  }
  lines.push("docker compose up -d --force-recreate", "docker compose ps");
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
 * @param {Record<string, unknown>} homepage
 * @param {Record<string, unknown>} install
 * @param {string} packageRoot
 * @param {{ widgetEnvLines?: string[] }} [opts]
 */
export async function installHomepageInCt(user, pveHost, vmid, homepage, install, packageRoot, opts = {}) {
  errout.write(`[hdc] homepage install: Docker Compose in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, "homepage install");
  if (!ready) {
    return { ok: false, method: "docker-compose", message: `CT ${vmid} not reachable via pct exec` };
  }

  const envContent = renderHomepageEnv(homepage, opts.widgetEnvLines ?? []);
  const composeYaml = renderComposeYaml();
  const configFiles = loadHomepageConfigFiles(homepage, packageRoot);
  const dir = composeDir(install);
  const inner = buildInstallScript(dir, composeYaml, envContent, configFiles);

  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return {
      ok: false,
      method: "docker-compose",
      message: `install failed (exit ${r.status})`,
    };
  }

  const ip = readCtPrimaryIp(user, pveHost, vmid);
  errout.write(`[hdc] homepage install: completed on CT ${vmid}.\n`);
  return {
    ok: true,
    method: "docker-compose",
    message: "installed",
    web_url: resolveWebUrl(homepage),
    upstream_url: resolveUpstreamUrl(ip, homepage),
    ct_ip: ip,
    config_paths: configFiles.config_paths,
  };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} homepage
 * @param {Record<string, unknown>} install
 * @param {string} packageRoot
 * @param {{ skipUpgrade?: boolean; widgetEnvLines?: string[] }} [opts]
 */
export async function maintainHomepageInCt(user, pveHost, vmid, homepage, install, packageRoot, opts = {}) {
  errout.write(`[hdc] homepage maintain: refreshing stack in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, "homepage maintain");
  if (!ready) {
    return { ok: false, message: `CT ${vmid} not reachable via pct exec` };
  }

  const envContent = renderHomepageEnv(homepage, opts.widgetEnvLines ?? []);
  const configFiles = loadHomepageConfigFiles(homepage, packageRoot);
  const dir = composeDir(install);
  const composeYaml = renderComposeYaml();
  const inner = buildMaintainScript(dir, envContent, configFiles, composeYaml, opts);
  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return { ok: false, message: `maintain failed (exit ${r.status})` };
  }
  const ip = readCtPrimaryIp(user, pveHost, vmid);
  return {
    ok: true,
    message: opts.skipUpgrade ? "restarted" : "images refreshed",
    web_url: resolveWebUrl(homepage),
    upstream_url: resolveUpstreamUrl(ip, homepage),
    ct_ip: ip,
    config_paths: configFiles.config_paths,
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
