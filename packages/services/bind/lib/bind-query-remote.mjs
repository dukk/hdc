import { sshRemote } from "../../../lib/pve-pct-remote.mjs";

/**
 * @param {string} user
 * @param {string} host
 * @param {string} innerCommand
 */
export function sshCapture(user, host, innerCommand) {
  const escaped = innerCommand.replace(/'/g, `'\\''`);
  return sshRemote(user, host, `bash -lc '${escaped}'`, { capture: true });
}

/**
 * @param {string} user
 * @param {string} host
 */
export function queryNamedActive(user, host) {
  const r = sshCapture(user, host, "systemctl is-active named 2>/dev/null || echo inactive");
  return {
    ok: r.status === 0,
    active: r.stdout.trim() === "active",
    raw: r.stdout.trim(),
  };
}

/**
 * @param {string} user
 * @param {string} host
 * @param {string} zone
 * @param {string} [server] dig @server; defaults to host.
 */
export function querySoa(user, host, zone, server) {
  const at = server ? `@${server}` : `@${host}`;
  const r = sshCapture(user, host, `dig +short SOA ${zone} ${at} 2>/dev/null | head -1`);
  const line = r.stdout.trim();
  const serial = line ? line.split(/\s+/)[2] ?? "" : "";
  return { ok: r.status === 0 && Boolean(line), soa: line, serial };
}
