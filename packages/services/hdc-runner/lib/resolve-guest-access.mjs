import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
import { resolveConfigureExec } from "../../asterisk/lib/asterisk-configure.mjs";
import { readCtPrimaryIp, resolvePveSshForHost } from "../../gatus/lib/gatus-install.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Resolve SSH target for operator rsync to runner guest.
 *
 * @param {object} deployment
 * @param {string} deployment.systemId
 * @param {string} deployment.mode
 * @param {Record<string, unknown> | null} deployment.proxmox
 * @param {Record<string, unknown>} deployment.configure
 * @param {string} proxmoxRoot
 * @returns {{ host: string; user: string; port: number }}
 */
export function resolveRunnerGuestSsh(deployment, proxmoxRoot) {
  const configure = isObject(deployment.configure) ? deployment.configure : {};
  const ssh = isObject(configure.ssh) ? configure.ssh : {};
  const user = resolveGuestSshUser(ssh.user);
  const port =
    typeof ssh.port === "number" && Number.isFinite(ssh.port) ? ssh.port : Number(ssh.port) || 22;

  let host = typeof ssh.host === "string" ? ssh.host.trim() : "";
  if (host) return { host, user, port };

  const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
  if (deployment.mode === "proxmox-qemu") {
    const qemu = isObject(px.qemu) ? px.qemu : {};
    const ip = typeof qemu.ip === "string" ? qemu.ip.trim() : "";
    if (ip) host = ip.split("/")[0];
  }

  if (!host && deployment.mode === "proxmox-lxc") {
    const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
    const lxc = isObject(px.lxc) ? px.lxc : {};
    const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
    if (hostId && Number.isFinite(vmid) && vmid > 0) {
      const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
      const ip = readCtPrimaryIp(pveSsh.user, pveSsh.host, vmid);
      if (ip) host = ip;
    }
  }

  if (!host) {
    throw new Error(
      `${deployment.systemId}: configure.ssh.host required (or proxmox guest IP must be reachable)`,
    );
  }
  return { host, user, port };
}

/**
 * @param {ReturnType<typeof resolveHdcRunnerDeployments>[number]} deployment
 * @param {string} proxmoxRoot
 */
export function resolveRunnerConfigureExec(deployment, proxmoxRoot) {
  return resolveConfigureExec(deployment, proxmoxRoot);
}
