import { sshRemote } from "../../postfix-relay/lib/remote.mjs";

/**
 * @param {string} user
 * @param {string} host
 * @param {string} splunkHome
 */
export function querySplunkStatus(user, host, splunkHome = "/opt/splunk") {
  const r = sshRemote(user, host, `${splunkHome}/bin/splunk status 2>&1`, { capture: true });
  const running = r.stdout.includes("splunkd is running");
  return { ok: r.status === 0, running, output: `${r.stdout}${r.stderr}`.trim() };
}

/**
 * @param {string} user
 * @param {string} host
 * @param {string} splunkHome
 */
export function querySplunkVersion(user, host, splunkHome = "/opt/splunk") {
  const r = sshRemote(user, host, `${splunkHome}/bin/splunk version 2>&1`, { capture: true });
  return { ok: r.status === 0, version: r.stdout.trim() };
}

/**
 * @param {string} user
 * @param {string} host
 * @param {number} port
 */
export function queryTcpPort(user, host, port) {
  const r = sshRemote(
    user,
    host,
    `timeout 3 bash -c 'echo >/dev/tcp/127.0.0.1/${port}' 2>/dev/null && echo open || echo closed`,
    { capture: true },
  );
  return { ok: r.stdout.trim() === "open", state: r.stdout.trim() };
}

/**
 * @param {string} user
 * @param {string} host
 * @param {string} varMount
 */
export function querySplunkVarDisk(user, host, varMount = "/opt/splunk/var") {
  const r = sshRemote(user, host, `df -hP ${varMount} 2>/dev/null | tail -1`, { capture: true });
  return { ok: r.status === 0, df: r.stdout.trim() };
}
