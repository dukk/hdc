import { pctExec } from "../../../lib/pve-pct-remote.mjs";
import { composeDir, hostPort, parsePublicUrl } from "./litellm-render.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {Record<string, unknown>} litellm
 * @param {Record<string, unknown>} install
 */
export async function queryLitellmInCt(user, pveHost, vmid, litellm, install) {
  const cfg = isObject(litellm) ? litellm : {};
  const port = hostPort(cfg);
  const dir = composeDir(isObject(install) ? install : {});
  let publicOrigin = null;
  try {
    const parsed = parsePublicUrl(cfg);
    publicOrigin = parsed ? parsed.origin.replace(/\/+$/, "") : null;
  } catch {
    publicOrigin = null;
  }

  const docker = pctExec(
    user,
    pveHost,
    vmid,
    "systemctl is-active docker 2>/dev/null || echo inactive",
    { capture: true },
  );
  const composePs = pctExec(
    user,
    pveHost,
    vmid,
    `test -d ${JSON.stringify(dir)} && cd ${JSON.stringify(dir)} && docker compose ps --format json 2>/dev/null || docker compose ps 2>/dev/null || echo '[]'`,
    { capture: true },
  );
  const ip = pctExec(user, pveHost, vmid, "hostname -I | awk '{print $1}'", { capture: true });
  const ctIp = ip.status === 0 ? ip.stdout.trim().split(/\s+/)[0] || null : null;

  let healthOk = null;
  let healthError = null;
  if (docker.stdout.trim() === "active") {
    const healthUrl = publicOrigin
      ? `${publicOrigin}/health/liveliness`
      : `http://127.0.0.1:${port}/health/liveliness`;
    const healthCmd = `curl -sf --max-time 5 ${JSON.stringify(healthUrl)} -o /dev/null && echo ok || echo fail`;
    const h = pctExec(user, pveHost, vmid, healthCmd, { capture: true });
    if (h.status === 0 && h.stdout.trim() === "ok") {
      healthOk = true;
    } else {
      healthOk = false;
      healthError = h.stderr.trim() || h.stdout.trim() || `exit ${h.status}`;
    }
  }

  const apiUrl = publicOrigin ? `${publicOrigin}/v1` : ctIp ? `http://${ctIp}:${port}/v1` : null;
  const uiUrl = publicOrigin ? `${publicOrigin}/ui` : ctIp ? `http://${ctIp}:${port}/ui` : null;

  return {
    vmid,
    docker_active: docker.stdout.trim(),
    compose_ps: composePs.stdout.trim() || null,
    ct_ip: ctIp,
    health_ok: healthOk,
    health_error: healthError,
    host_port: port,
    upstream_url: ctIp ? `http://${ctIp}:${port}` : null,
    api_url: apiUrl,
    ui_url: uiUrl,
  };
}
