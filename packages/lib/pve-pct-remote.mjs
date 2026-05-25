import { spawnSync } from "node:child_process";

const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"];

/**
 * @param {string} user
 * @param {string} host
 * @param {string} remoteCommand
 * @param {{ capture?: boolean }} [opts]
 */
export function sshRemote(user, host, remoteCommand, opts = {}) {
  const capture = Boolean(opts.capture);
  const r = spawnSync(
    "ssh",
    [...SSH_OPTS, `${user}@${host}`, remoteCommand],
    capture
      ? { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
      : { encoding: "utf8", stdio: "inherit" },
  );
  return {
    status: r.status ?? 1,
    stdout: capture ? String(r.stdout ?? "") : "",
    stderr: capture ? String(r.stderr ?? "") : "",
  };
}

/**
 * Run a command inside an LXC via Proxmox `pct exec`.
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {string} innerCommand Shell passed to `bash -lc` inside the CT.
 * @param {{ capture?: boolean }} [opts]
 */
export function pctExec(user, pveHost, vmid, innerCommand, opts = {}) {
  const escaped = innerCommand.replace(/'/g, `'\\''`);
  const remote = `pct exec ${vmid} -- bash -lc '${escaped}'`;
  return sshRemote(user, pveHost, remote, opts);
}
