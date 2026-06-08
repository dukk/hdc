import { stderr as errout } from "node:process";

import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { waitForCt } from "../../ollama/lib/ollama-install.mjs";
import { resolvePveSshForHost } from "../../pi-hole/lib/pi-hole-install.mjs";
import { dashboardPort } from "./deployments.mjs";
import {
  buildDataDirScript,
  composeDir,
  renderComposeEnvFile,
  renderComposeYaml,
  renderHermesEnv,
  resolveDashboardUrl,
} from "./hermes-render.mjs";

export { resolvePveSshForHost };

/**
 * @param {string} composeDirPath
 * @param {string} composeYaml
 * @param {string} envContent
 * @param {string} composeTagEnv
 * @param {Record<string, unknown>} install
 */
export function buildInstallScript(composeDirPath, composeYaml, envContent, composeTagEnv, install) {
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
    buildDataDirScript(install),
    `mkdir -p '${dir}'`,
    `cat > '${dir}/docker-compose.yml' <<'HDCOMPOSE'`,
    composeYaml.trimEnd(),
    "HDCOMPOSE",
    `cat > '${dir}/.env' <<'HDCENV'`,
    envContent.trimEnd(),
    "HDCENV",
    `cat > '${dir}/.compose.env' <<'HDCTAG'`,
    composeTagEnv.trimEnd(),
    "HDCTAG",
    `cd '${dir}'`,
    "docker compose --env-file .compose.env pull",
    "docker compose --env-file .compose.env up -d",
    "docker compose --env-file .compose.env ps",
  ].join("\n");
}

/**
 * @param {string} composeDirPath
 * @param {string} envContent
 * @param {string} composeTagEnv
 * @param {Record<string, unknown>} install
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export function buildMaintainScript(composeDirPath, envContent, composeTagEnv, install, opts = {}) {
  const dir = composeDirPath.replace(/'/g, `'\\''`);
  const lines = [
    "set -euo pipefail",
    `test -f '${dir}/docker-compose.yml'`,
    buildDataDirScript(install),
    `cat > '${dir}/.env' <<'HDCENV'`,
    envContent.trimEnd(),
    "HDCENV",
    `cat > '${dir}/.compose.env' <<'HDCTAG'`,
    composeTagEnv.trimEnd(),
    "HDCTAG",
    `cd '${dir}'`,
  ];
  if (!opts.skipUpgrade) {
    lines.push("docker compose --env-file .compose.env pull");
  }
  lines.push(
    "docker compose --env-file .compose.env up -d",
    "docker compose --env-file .compose.env ps",
  );
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
    `  cd '${dir}' && docker compose --env-file .compose.env down 2>/dev/null || docker compose down 2>/dev/null || true`,
    "fi",
  ].join("\n");
}

/**
 * @param {number} port
 * @param {number} [timeoutMs]
 */
export function buildWaitDashboardScript(port, timeoutMs = 600000) {
  const deadline = Math.max(60, Math.floor(timeoutMs / 1000));
  return [
    "set -euo pipefail",
    `port=${port}`,
    `deadline=$(( $(date +%s) + ${deadline} ))`,
    "while [ \"$(date +%s)\" -lt \"$deadline\" ]; do",
    "  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \"http://127.0.0.1:${port}/\" || true)",
    "  if [ \"$code\" = \"200\" ] || [ \"$code\" = \"302\" ] || [ \"$code\" = \"401\" ]; then",
    "    exit 0",
    "  fi",
    "  sleep 5",
    "done",
    "echo 'Hermes dashboard HTTP did not become ready in time' >&2",
    "exit 1",
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
 * @param {Record<string, unknown>} hermes
 */
async function waitForHermesDashboard(user, pveHost, vmid, hermes) {
  const port = dashboardPort(hermes);
  errout.write(`[hdc] hermes install: waiting for dashboard HTTP on port ${port} in CT ${vmid} …\n`);
  const inner = buildWaitDashboardScript(port);
  const r = pctExec(user, pveHost, vmid, inner);
  return r.status === 0;
}

/**
 * @param {import("./vault-secrets.mjs").resolveHermesSecrets extends (...args: any) => Promise<infer R> ? R : never} secrets
 */
function secretsToEnvInput(secrets) {
  return {
    openrouterApiKey: secrets.openrouterApiKey,
    dashboardPassword: secrets.dashboardPassword,
    dashboardAuthSecret: secrets.dashboardAuthSecret,
  };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} hermes
 * @param {Record<string, unknown>} install
 * @param {Awaited<ReturnType<import("./vault-secrets.mjs").resolveHermesSecrets>>} secrets
 */
export async function installHermesInCt(user, pveHost, vmid, hermes, install, secrets) {
  errout.write(`[hdc] hermes install: Docker Compose in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, "hermes install");
  if (!ready) {
    return { ok: false, method: "docker-compose", message: `CT ${vmid} not reachable via pct exec` };
  }

  const envContent = renderHermesEnv(hermes, secretsToEnvInput(secrets), secrets.extraEnv);
  const composeYaml = renderComposeYaml(hermes, install);
  const composeTagEnv = renderComposeEnvFile(hermes);
  const dir = composeDir(install);
  const inner = buildInstallScript(dir, composeYaml, envContent, composeTagEnv, install);

  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return {
      ok: false,
      method: "docker-compose",
      message: `install failed (exit ${r.status})`,
    };
  }

  const httpReady = await waitForHermesDashboard(user, pveHost, vmid, hermes);
  if (!httpReady) {
    return {
      ok: false,
      method: "docker-compose",
      message: "Hermes dashboard HTTP did not become ready",
    };
  }

  const ip = readCtPrimaryIp(user, pveHost, vmid);
  const dashboardUrl = resolveDashboardUrl(hermes, ip);
  errout.write(`[hdc] hermes install: completed on CT ${vmid}.\n`);
  return {
    ok: true,
    method: "docker-compose",
    message: "installed",
    dashboard_url: dashboardUrl,
  };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} hermes
 * @param {Record<string, unknown>} install
 * @param {Awaited<ReturnType<import("./vault-secrets.mjs").resolveHermesSecrets>>} secrets
 * @param {{ skipUpgrade?: boolean }} [opts]
 */
export async function maintainHermesInCt(user, pveHost, vmid, hermes, install, secrets, opts = {}) {
  errout.write(`[hdc] hermes maintain: refreshing stack in CT ${vmid} …\n`);

  const ready = await waitForCt(user, pveHost, vmid, 2000, "hermes maintain");
  if (!ready) {
    return { ok: false, message: `CT ${vmid} not reachable via pct exec` };
  }

  const envContent = renderHermesEnv(hermes, secretsToEnvInput(secrets), secrets.extraEnv);
  const composeTagEnv = renderComposeEnvFile(hermes);
  const dir = composeDir(install);
  const inner = buildMaintainScript(dir, envContent, composeTagEnv, install, {
    skipUpgrade: opts.skipUpgrade,
  });
  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return { ok: false, message: `maintain failed (exit ${r.status})` };
  }

  return { ok: true, message: "stack refreshed" };
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
