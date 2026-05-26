import { spawnSync } from "node:child_process";
import { devNull } from "node:os";

const SSH_OPTS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  `UserKnownHostsFile=${devNull}`,
];

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

/**
 * Parse `qm guest exec` JSON stdout (Proxmox returns exitcode + out-data).
 * @param {string} raw
 */
export function parseQmGuestExecStdout(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed.startsWith("{")) {
    return { status: 0, stdout: trimmed, stderr: "" };
  }
  try {
    const j = JSON.parse(trimmed);
    const status = Number(j.exitcode ?? j["exit-code"] ?? 1);
    return {
      status: Number.isFinite(status) ? status : 1,
      stdout: String(j["out-data"] ?? j.outdata ?? ""),
      stderr: String(j["err-data"] ?? j.errdata ?? ""),
    };
  } catch {
    return { status: 1, stdout: "", stderr: trimmed };
  }
}

/**
 * Run a command inside a QEMU guest via Proxmox `qm guest exec` (requires guest agent).
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {string} innerCommand Shell passed to `bash -lc` inside the guest.
 * @param {{ capture?: boolean }} [opts]
 */
export function qemuGuestExec(user, pveHost, vmid, innerCommand, opts = {}) {
  const escaped = innerCommand.replace(/'/g, `'\\''`);
  const remote = `qm guest exec ${vmid} -- bash -lc '${escaped}'`;
  const r = sshRemote(user, pveHost, remote, opts);
  if (!opts.capture) return r;
  const parsed = parseQmGuestExecStdout(r.stdout);
  return {
    status: parsed.status,
    stdout: parsed.stdout,
    stderr: parsed.stderr || r.stderr,
  };
}
