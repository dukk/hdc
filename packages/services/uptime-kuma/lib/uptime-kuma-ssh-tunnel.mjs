import { spawn } from "node:child_process";
import { devNull } from "node:os";

const SSH_OPTS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  `UserKnownHostsFile=${devNull}`,
  "-o",
  "ConnectTimeout=15",
];

/**
 * @param {string} apiUrl
 */
export function parseLocalApiPort(apiUrl) {
  try {
    const u = new URL(apiUrl);
    if (!/^127\.0\.0\.1|localhost$/i.test(u.hostname)) return null;
    const port = u.port ? Number(u.port) : 80;
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.user
 * @param {string} opts.host
 * @param {number} opts.localPort
 * @param {number} opts.remotePort
 * @param {(line: string) => void} [opts.log]
 */
export function startUptimeKumaSshTunnel(opts) {
  const { user, host, localPort, remotePort } = opts;
  const log = opts.log ?? (() => {});
  const args = [
    ...SSH_OPTS,
    "-N",
    "-L",
    `${localPort}:127.0.0.1:${remotePort}`,
    `${user}@${host}`,
  ];
  log(`SSH tunnel -L ${localPort}:127.0.0.1:${remotePort} ${user}@${host}`);
  const child = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
  return child;
}

/**
 * @param {object} opts
 * @param {string} opts.apiUrl
 * @param {Record<string, unknown>} configure
 * @param {(line: string) => void} [opts.log]
 * @param {() => Promise<unknown>} fn
 */
export async function withUptimeKumaSshTunnelIfNeeded(opts, fn) {
  const configure = opts.configure ?? {};
  const ssh = configure.ssh && typeof configure.ssh === "object" ? configure.ssh : {};
  const host = typeof ssh.host === "string" ? ssh.host.trim() : "";
  const user = typeof ssh.user === "string" && ssh.user.trim() ? ssh.user.trim() : "ubuntu";
  const remotePort = parseLocalApiPort(opts.apiUrl);
  const needsTunnel = Boolean(host && remotePort != null);

  if (!needsTunnel) {
    return fn();
  }

  const localPort = remotePort;
  const child = startUptimeKumaSshTunnel({
    user,
    host,
    localPort,
    remotePort,
    log: opts.log,
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SSH tunnel to ${user}@${host} did not become ready`));
    }, 15000);
    child.stderr?.on("data", () => {});
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("spawn", () => {
      setTimeout(() => {
        clearTimeout(timer);
        resolve(undefined);
      }, 800);
    });
    child.on("exit", (code) => {
      if (code != null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`SSH tunnel exited with code ${code}`));
      }
    });
  });

  try {
    return await fn();
  } finally {
    child.kill("SIGTERM");
  }
}
