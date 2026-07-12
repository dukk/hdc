import { stderr as errout } from "node:process";

import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { waitForCt } from "../../ollama/lib/ollama-install.mjs";
import { resolvePveSshForHost } from "../../pi-hole/lib/pi-hole-install.mjs";
import { crowdsecLapiPort } from "./deployments.mjs";

export { resolvePveSshForHost };

/**
 * @param {number} lapiPort
 * @param {{ upgrade?: boolean }} [opts]
 */
export function buildInstallScript(lapiPort, opts = {}) {
  const port = Number.isFinite(lapiPort) ? lapiPort : 8080;
  const upgrade = opts.upgrade === true;
  const lines = [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq",
    "apt-get install -y -qq curl ca-certificates",
    "if ! command -v crowdsec >/dev/null 2>&1; then",
    "  curl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | bash",
    "  apt-get update -qq",
    "  apt-get install -y -qq crowdsec crowdsec-firewall-bouncer",
    "fi",
  ];
  if (upgrade) {
    lines.push("apt-get install -y -qq --only-upgrade crowdsec crowdsec-firewall-bouncer || true");
  }
  lines.push(
    "mkdir -p /etc/crowdsec",
    "if [ -f /etc/crowdsec/config.yaml ]; then",
    "  sed -i \"s/^#\\\\? *listen_uri: .*/listen_uri: 127.0.0.1:${LAPI_PORT}/\" /etc/crowdsec/config.yaml || true",
    "fi",
    "if command -v cscli >/dev/null 2>&1; then",
    "  cscli config set api.server.enable true || true",
    "  cscli config set api.server.listen_uri 127.0.0.1:${LAPI_PORT} || true",
    "fi",
    "systemctl enable crowdsec 2>/dev/null || true",
    "systemctl restart crowdsec",
    "sleep 2",
    "systemctl is-active --quiet crowdsec",
    "if command -v cscli >/dev/null 2>&1; then cscli lapi status >/dev/null 2>&1 || true; fi",
  );
  return [`LAPI_PORT=${port}`, ...lines].join("\n");
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} crowdsec
 * @param {{ upgrade?: boolean }} [opts]
 */
export async function installCrowdsecInCt(user, pveHost, vmid, crowdsec, opts = {}) {
  const label = opts.upgrade ? "upgrade" : "install";
  errout.write(`[hdc] crowdsec ${label}: configuring CT ${vmid} ...\n`);
  const ready = await waitForCt(user, pveHost, vmid, 2000, `crowdsec ${label}`);
  if (!ready) {
    return { ok: false, method: label, message: `CT ${vmid} not reachable via pct exec` };
  }
  const inner = buildInstallScript(crowdsecLapiPort(crowdsec), opts);
  const r = pctExec(user, pveHost, vmid, inner);
  if (r.status !== 0) {
    return {
      ok: false,
      method: label,
      message: `${label} failed (exit ${r.status})`,
      stderr: r.stderr?.slice(0, 800),
    };
  }
  errout.write(`[hdc] crowdsec ${label}: completed on CT ${vmid}.\n`);
  return { ok: true, method: label, message: label === "upgrade" ? "upgraded" : "installed" };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} crowdsec
 */
export function maintainCrowdsecInCt(user, pveHost, vmid, crowdsec) {
  return installCrowdsecInCt(user, pveHost, vmid, crowdsec, { upgrade: true });
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 */
export function crowdsecInstalled(user, pveHost, vmid) {
  const r = pctExec(
    user,
    pveHost,
    vmid,
    "command -v crowdsec >/dev/null 2>&1 && systemctl list-unit-files crowdsec.service >/dev/null 2>&1 && echo yes",
    { capture: true },
  );
  return r.status === 0 && r.stdout.trim() === "yes";
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
 */
export function queryCrowdsecStatusInCt(user, pveHost, vmid) {
  const svc = pctExec(user, pveHost, vmid, "systemctl is-active crowdsec 2>/dev/null || echo inactive", {
    capture: true,
  });
  const lapi = pctExec(user, pveHost, vmid, "cscli lapi status 2>/dev/null || true", { capture: true });
  return {
    service: svc.stdout.trim() || "unknown",
    lapi_status: lapi.stdout.trim() || null,
  };
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {string} keyName
 */
export function createBouncerKeyInCt(user, pveHost, vmid, keyName) {
  const safe = keyName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const cmd = [
    "set -euo pipefail",
    `NAME=${JSON.stringify(safe)}`,
    'cscli bouncers delete "$NAME" >/dev/null 2>&1 || true',
    'cscli bouncers add "$NAME" -o raw',
  ].join("\n");
  const r = pctExec(user, pveHost, vmid, cmd, { capture: true });
  if (r.status !== 0) {
    return { ok: false, message: `cscli bouncers add failed (exit ${r.status})` };
  }
  const apiKey = r.stdout.trim();
  if (!apiKey) return { ok: false, message: "empty bouncer api key from cscli" };
  return { ok: true, apiKey };
}
