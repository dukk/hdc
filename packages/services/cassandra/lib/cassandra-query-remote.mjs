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
export function queryCassandraActive(user, host) {
  const r = sshCapture(user, host, "systemctl is-active cassandra 2>/dev/null || echo inactive");
  return {
    ok: r.status === 0,
    active: r.stdout.trim() === "active",
    raw: r.stdout.trim(),
  };
}

/**
 * @param {string} user
 * @param {string} host
 */
export function queryNodetoolStatus(user, host) {
  const r = sshCapture(user, host, "nodetool status 2>/dev/null");
  const lines = r.stdout.split("\n").filter((l) => l.trim());
  /** @type {{ address: string; state: string; load: string; owns: string }[]} */
  const nodes = [];
  for (const line of lines) {
    const m = line.match(/^(UN|DN|UJ|UL|UM)\s+(\S+)\s+/);
    if (m) {
      nodes.push({
        state: m[1],
        address: m[2],
        line: line.trim(),
      });
    }
  }
  const selfUn = nodes.some((n) => n.state === "UN");
  return {
    ok: r.status === 0,
    raw: r.stdout.trim(),
    nodes,
    allUn: nodes.length > 0 && nodes.every((n) => n.state === "UN"),
    selfUn,
  };
}

/**
 * @param {string} user
 * @param {string} host
 * @param {string} listenIp
 * @param {number} [timeoutMs]
 * @param {(msg: string) => void} [onProgress]
 */
export async function waitForNodeUn(user, host, listenIp, timeoutMs = 600_000, onProgress) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    onProgress?.(`waiting for ${listenIp} UN (attempt ${attempt}) …`);
    const st = queryNodetoolStatus(user, host);
    const node = st.nodes.find((n) => n.address === listenIp || n.address.startsWith(listenIp));
    if (node?.state === "UN") {
      return { ok: true, state: "UN", nodetool: st };
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return { ok: false, message: `timeout waiting for ${listenIp} to reach UN` };
}
