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
export function queryKafkaServiceActive(user, host) {
  const r = sshCapture(user, host, "systemctl is-active kafka 2>/dev/null || echo inactive");
  return {
    ok: r.status === 0,
    active: r.stdout.trim() === "active",
    raw: r.stdout.trim(),
  };
}

/**
 * @param {string} user
 * @param {string} host
 * @param {number} listenerPort
 */
export function queryBrokerApiVersions(user, host, listenerPort) {
  const r = sshCapture(
    user,
    host,
    `test -x /opt/kafka/bin/kafka-broker-api-versions.sh && /opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server 127.0.0.1:${listenerPort} 2>&1 | head -3`,
  );
  const ok = r.status === 0 && r.stdout.trim().length > 0;
  return { ok, output: r.stdout.trim().slice(0, 500) };
}
