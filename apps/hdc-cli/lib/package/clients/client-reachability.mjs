import { connect } from "node:net";

/**
 * TCP connect probe. Connection refused => host is up (service down).
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<"open" | "refused" | "unreachable">}
 */
export function tcpReachability(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: timeoutMs });
    const done = (/** @type {"open" | "refused" | "unreachable"} */ state) => {
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(state);
    };
    socket.once("connect", () => done("open"));
    socket.once("timeout", () => done("unreachable"));
    socket.once("error", (err) => {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (code === "ECONNREFUSED" || code === "EHOSTUNREACH") {
        done(code === "ECONNREFUSED" ? "refused" : "unreachable");
        return;
      }
      done("unreachable");
    });
  });
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 */
export async function isHostOnline(host, port, timeoutMs = 4000) {
  const r = await tcpReachability(host, port, timeoutMs);
  return r === "open" || r === "refused";
}

/** Common LAN probe ports when WinRM is not yet configured. */
const WINDOWS_LAN_PROBE_PORTS = [445, 5986, 3389];

/**
 * Windows hosts may block/filter WinRM until bootstrap; treat SMB/RDP/WinRM probes as "powered on".
 * @param {string} host
 * @param {number} [timeoutMs]
 */
export async function isWindowsHostOnline(host, timeoutMs = 4000) {
  const results = await Promise.all(
    WINDOWS_LAN_PROBE_PORTS.map((port) => tcpReachability(host, port, timeoutMs)),
  );
  return results.some((r) => r === "open" || r === "refused");
}
