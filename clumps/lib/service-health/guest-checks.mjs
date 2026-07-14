import { createConnection } from "node:net";

import { createGuestSshExec } from "../guest-ssh-exec.mjs";
import { loadManualSystemSidecar, primaryIpFromSystem } from "../inventory-sidecar.mjs";
import { pctExec } from "../pve-pct-remote.mjs";

/**
 * @typedef {{ ok: boolean|null, skipped: boolean, detail?: string, docker_active?: string|null, compose_ok?: boolean|null }} GuestLayer
 */

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
function tcpConnect(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const t = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on("connect", () => {
      clearTimeout(t);
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

/**
 * Resolve Proxmox SSH user/host for pct from inventory host_id.
 * @param {string} repoRoot
 * @param {string|null} hostId
 */
function resolvePveTarget(repoRoot, hostId) {
  if (!hostId) return null;
  const sidecar = loadManualSystemSidecar(repoRoot, hostId);
  if (!sidecar) return null;
  const ip = primaryIpFromSystem(sidecar);
  if (!ip) return null;
  /** @type {string} */
  let user = "root";
  const access = isObject(sidecar.access) ? /** @type {Record<string, unknown>} */ (sidecar.access) : {};
  const nodes = Array.isArray(access.nodes) ? access.nodes : [];
  for (const n of nodes) {
    if (!isObject(n)) continue;
    const ssh = isObject(n.ssh) ? /** @type {Record<string, unknown>} */ (n.ssh) : null;
    if (ssh && typeof ssh.user === "string" && ssh.user.trim()) {
      user = ssh.user.trim();
      break;
    }
  }
  return { user, host: ip };
}

/**
 * Lightweight guest check: docker/systemd via pct or SSH, plus local curl.
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.family
 * @param {string|null} opts.guestIp
 * @param {number} opts.port
 * @param {string} opts.path
 * @param {number|null} [opts.vmid]
 * @param {string|null} [opts.hostId]
 * @param {string} [opts.mode]
 */
export function probeGuest(opts) {
  const family = opts.family;
  if (family === "infra-api" || family === "client" || family === "self-edge") {
    return { ok: null, skipped: true, detail: `guest skip for family ${family}` };
  }

  const path = opts.path?.startsWith("/") ? opts.path : "/";
  const port = opts.port || 80;
  const localCurl = `curl -sf --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}${path} || echo fail`;

  if (
    (opts.mode === "proxmox-lxc" || family === "docker-lxc") &&
    opts.vmid &&
    opts.hostId
  ) {
    const pve = resolvePveTarget(opts.repoRoot, opts.hostId);
    if (!pve) {
      return { ok: null, skipped: true, detail: `no pve ssh for host_id ${opts.hostId}` };
    }
    try {
      const docker = pctExec(
        pve.user,
        pve.host,
        opts.vmid,
        "systemctl is-active docker 2>/dev/null || echo inactive",
        { capture: true },
      );
      const curl = pctExec(pve.user, pve.host, opts.vmid, localCurl, { capture: true });
      const code = String(curl.stdout ?? "").trim();
      const httpOk = /^\d+$/.test(code) && Number(code) > 0 && Number(code) < 500;
      const dockerActive = String(docker.stdout ?? "").trim();
      const ok = httpOk || dockerActive === "active";
      return {
        ok,
        skipped: false,
        detail: `pct docker=${dockerActive} http=${code}`,
        docker_active: dockerActive,
        compose_ok: httpOk,
      };
    } catch (e) {
      return {
        ok: false,
        skipped: false,
        detail: String(/** @type {Error} */ (e).message || e).slice(0, 240),
      };
    }
  }

  const host = opts.guestIp;
  if (!host) {
    return { ok: null, skipped: true, detail: "no guest ip" };
  }
  try {
    const exec = createGuestSshExec({ host });
    const r = exec.run(
      [
        "set +e",
        "echo DOCKER:$(systemctl is-active docker 2>/dev/null || echo inactive)",
        `echo HTTP:$(${localCurl})`,
      ].join("; "),
      { capture: true },
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const dockerM = out.match(/DOCKER:(\S+)/);
    const httpM = out.match(/HTTP:(\S+)/);
    const dockerActive = dockerM?.[1] ?? null;
    const code = httpM?.[1] ?? "fail";
    const httpOk = /^\d+$/.test(code) && Number(code) > 0 && Number(code) < 500;
    if ((r.status ?? 1) !== 0 && !httpOk) {
      return {
        ok: false,
        skipped: false,
        detail: out.trim().slice(0, 240) || `ssh exit ${r.status}`,
        docker_active: dockerActive,
      };
    }
    return {
      ok: httpOk || dockerActive === "active",
      skipped: false,
      detail: `ssh docker=${dockerActive} http=${code}`,
      docker_active: dockerActive,
      compose_ok: httpOk,
    };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      detail: String(/** @type {Error} */ (e).message || e).slice(0, 240),
    };
  }
}

/**
 * @param {boolean} configLoaded
 * @returns {GuestLayer}
 */
export function probeInfraApiConfig(configLoaded) {
  if (!configLoaded) {
    return { ok: null, skipped: false, detail: "config not loaded" };
  }
  return { ok: true, skipped: false, detail: "config present (live API not probed)" };
}

/**
 * Client reachability: TCP to common management ports (WinRM 5986, SSH 22).
 * @param {string|null} ip
 * @returns {Promise<GuestLayer>}
 */
export async function probeClientReachability(ip) {
  if (!ip) {
    return { ok: null, skipped: true, detail: "no client ip" };
  }
  const ports = [5986, 22, 5985];
  /** @type {string[]} */
  const hit = [];
  for (const p of ports) {
    // eslint-disable-next-line no-await-in-loop
    if (await tcpConnect(ip, p)) hit.push(String(p));
  }
  if (hit.length) {
    return { ok: true, skipped: false, detail: `tcp open on ${ip}:${hit.join(",")}` };
  }
  return { ok: false, skipped: false, detail: `no tcp on ${ip} ports ${ports.join(",")}` };
}
