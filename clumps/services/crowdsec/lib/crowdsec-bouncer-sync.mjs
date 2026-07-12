import { loadManualSystemSidecar, primaryIpFromSystem } from "../../../lib/inventory-sidecar.mjs";
import { createGuestSshExec } from "../../../lib/guest-ssh-exec.mjs";
import { crowdsecBouncers, crowdsecLapiPort } from "./deployments.mjs";
import { createBouncerKeyInCt } from "./crowdsec-install.mjs";

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.lapiUser
 * @param {string} opts.lapiHost
 * @param {number} opts.lapiVmid
 * @param {string | null} opts.lapiIp
 * @param {Record<string, unknown>} opts.crowdsec
 * @param {(line: string) => void} [opts.log]
 */
export async function syncCrowdsecBouncers(opts) {
  const log = opts.log ?? (() => {});
  const lapiPort = crowdsecLapiPort(opts.crowdsec);
  const lapiIp = typeof opts.lapiIp === "string" && opts.lapiIp.trim() ? opts.lapiIp.trim() : null;
  if (!lapiIp) {
    return { ok: false, message: "unable to resolve CrowdSec CT IP for bouncer sync", results: [] };
  }
  const bouncers = crowdsecBouncers(opts.crowdsec);
  if (!bouncers.length) {
    return { ok: true, message: "no bouncers configured", results: [] };
  }

  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const b of bouncers) {
    const systemId = b.system_id;
    const sidecar = loadManualSystemSidecar(opts.repoRoot, systemId);
    const ip = primaryIpFromSystem(sidecar);
    if (!ip) {
      results.push({ ok: false, system_id: systemId, message: "missing access.nodes[0].ip in system sidecar" });
      continue;
    }
    const keyName = `nginx-${systemId}`;
    const keyRes = createBouncerKeyInCt(opts.lapiUser, opts.lapiHost, opts.lapiVmid, keyName);
    if (!keyRes.ok) {
      results.push({ ok: false, system_id: systemId, message: keyRes.message });
      continue;
    }
    const apiKey = keyRes.apiKey;
    const exec = createGuestSshExec({ host: ip, log });
    const installScript = [
      "set -euo pipefail",
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update -qq",
      "if ! dpkg -s crowdsec-nginx-bouncer >/dev/null 2>&1; then",
      "  if ! command -v crowdsec >/dev/null 2>&1; then",
      "    curl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | bash",
      "    apt-get update -qq",
      "  fi",
      "  apt-get install -y -qq crowdsec-nginx-bouncer || apt-get install -y -qq crowdsec-firewall-bouncer-nginx",
      "fi",
      "mkdir -p /etc/crowdsec/bouncers",
      `cat > /etc/crowdsec/bouncers/crowdsec-nginx-bouncer.yaml <<'EOBC'`,
      `api_url: http://${lapiIp}:${lapiPort}`,
      `api_key: ${apiKey}`,
      "EOBC",
      "systemctl enable crowdsec-nginx-bouncer 2>/dev/null || true",
      "systemctl restart crowdsec-nginx-bouncer 2>/dev/null || true",
      "systemctl is-active crowdsec-nginx-bouncer 2>/dev/null || systemctl is-active crowdsec-firewall-bouncer-nginx 2>/dev/null || true",
    ].join("\n");
    const r = exec.run(installScript, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      results.push({ ok: false, system_id: systemId, ip, message: detail });
      continue;
    }
    results.push({
      ok: true,
      system_id: systemId,
      ip,
      ssh_user: exec.effectiveUser,
      fallback_used: exec.fallback_used,
      message: "bouncer synced",
    });
  }
  return {
    ok: results.every((r) => r.ok),
    message: "bouncer sync completed",
    lapi_url: `http://${lapiIp}:${lapiPort}`,
    results,
  };
}
