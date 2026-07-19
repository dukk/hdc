import { spawnSync } from "node:child_process";
import { devNull } from "node:os";

const SSH_OPTS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  `UserKnownHostsFile=${devNull}`,
  "-o",
  "ConnectTimeout=15",
  "-o",
  "ServerAliveInterval=30",
  "-o",
  "ServerAliveCountMax=6",
];

/** Default hard timeout for a single remote command (override: HDC_SSH_COMMAND_TIMEOUT_MS). */
export const SSH_DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * @param {{ timeoutMs?: number } | undefined} opts
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveSshCommandTimeoutMs(opts, env = process.env) {
  const fromOpts = Number(opts?.timeoutMs);
  if (Number.isFinite(fromOpts) && fromOpts > 0) return Math.round(fromOpts);
  const fromEnv = Number(env.HDC_SSH_COMMAND_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.round(fromEnv);
  return SSH_DEFAULT_COMMAND_TIMEOUT_MS;
}

/**
 * @param {ReturnType<typeof spawnSync>} r
 * @param {boolean} capture
 * @param {number} timeoutMs
 */
function spawnResultToRemoteResult(r, capture, timeoutMs) {
  const timedOut = r.error != null && /** @type {NodeJS.ErrnoException} */ (r.error).code === "ETIMEDOUT";
  const stderrBase = capture ? String(r.stderr ?? "") : "";
  return {
    status: r.status ?? 1,
    stdout: capture ? String(r.stdout ?? "") : "",
    stderr: timedOut
      ? `${stderrBase}${stderrBase ? "\n" : ""}remote command timed out after ${timeoutMs}ms`
      : stderrBase,
    timedOut,
  };
}

/**
 * @param {string} user
 * @param {string} host
 * @param {string} remoteCommand
 * @param {{ capture?: boolean; timeoutMs?: number }} [opts]
 */
export function sshRemote(user, host, remoteCommand, opts = {}) {
  const capture = Boolean(opts.capture);
  const timeoutMs = resolveSshCommandTimeoutMs(opts);
  const r = spawnSync(
    "ssh",
    [...SSH_OPTS, `${user}@${host}`, remoteCommand],
    {
      encoding: "utf8",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      ...(capture ? { stdio: ["pipe", "pipe", "pipe"] } : { stdio: "inherit" }),
    },
  );
  return spawnResultToRemoteResult(r, capture, timeoutMs);
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
  const script = String(innerCommand ?? "");
  if (opts.stdin || script.length > 8000) {
    return pctExecScript(user, pveHost, vmid, script, opts);
  }
  const escaped = script.replace(/'/g, `'\\''`);
  const remote = `pct exec ${vmid} -- bash -lc '${escaped}'`;
  return sshRemote(user, pveHost, remote, opts);
}

/**
 * Run a multi-line script inside an LXC via `pct exec … bash -s` (stdin).
 * Use for large payloads that exceed SSH command-line limits.
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {string} innerCommand
 * @param {{ capture?: boolean; timeoutMs?: number }} [opts]
 */
export function pctExecScript(user, pveHost, vmid, innerCommand, opts = {}) {
  const capture = Boolean(opts.capture);
  const timeoutMs = resolveSshCommandTimeoutMs(opts);
  const remote = `pct exec ${vmid} -- bash -s`;
  const r = spawnSync("ssh", [...SSH_OPTS, `${user}@${pveHost}`, remote], {
    encoding: "utf8",
    input: String(innerCommand ?? ""),
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
  });
  return spawnResultToRemoteResult(r, capture, timeoutMs);
}

/**
 * Set LXC options via Proxmox `pct set` on the node (SSH). Use for privileged CT feature flags
 * when the API token cannot pass `features` on create (root@pam only).
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {string} features e.g. `nesting=1,keyctl=1`
 * @param {{ capture?: boolean }} [opts]
 */
export function pctSetFeatures(user, pveHost, vmid, features, opts = {}) {
  const f = String(features ?? "").trim();
  if (!f) return { status: 0, stdout: "", stderr: "" };
  const remote = `pct set ${vmid} -features ${f}`;
  return sshRemote(user, pveHost, remote, opts);
}

/**
 * AppArmor workaround for Docker in Ubuntu LXC (CVE-2025-52881 / runc#4968).
 * Appends lines to /etc/pve/lxc/<vmid>.conf when missing; returns whether config changed.
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {{ capture?: boolean }} [opts]
 */
export function ensureLxcDockerApparmorWorkaround(user, pveHost, vmid, opts = {}) {
  const conf = `/etc/pve/lxc/${vmid}.conf`;
  const remote = [
    "set -euo pipefail",
    `CONF='${conf}'`,
    'test -f "$CONF"',
    'changed=0',
    `grep -q 'lxc.apparmor.profile: unconfined' "$CONF" || { echo 'lxc.apparmor.profile: unconfined' >> "$CONF"; changed=1; }`,
    `grep -q 'lxc.mount.entry: /dev/null sys/module/apparmor/parameters/enabled' "$CONF" || { echo 'lxc.mount.entry: /dev/null sys/module/apparmor/parameters/enabled none bind 0 0' >> "$CONF"; changed=1; }`,
    'echo "changed=$changed"',
  ].join("\n");
  return sshRemote(user, pveHost, remote, opts);
}

/**
 * @param {string} user
 * @param {string} pveHost
 * @param {number} vmid
 * @param {{ capture?: boolean }} [opts]
 */
export function pctRestart(user, pveHost, vmid, opts = {}) {
  const remote = `pct stop ${vmid} 2>/dev/null || true; pct start ${vmid}`;
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
