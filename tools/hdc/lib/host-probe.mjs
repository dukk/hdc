import os from "node:os";

/** @typedef {{ hostname: string, ips: string[], platform: string, arch: string }} HostProbe */

/**
 * @returns {HostProbe}
 */
export function defaultHostProbe() {
  const hostname = os.hostname().trim().toLowerCase();
  /** @type {string[]} */
  const ips = [];
  const ifs = os.networkInterfaces();
  if (ifs) {
    for (const name of Object.keys(ifs)) {
      const addrs = ifs[name];
      if (!addrs) continue;
      for (const a of addrs) {
        if (!a || a.internal) continue;
        if (a.family === "IPv4" || a.family === 4) ips.push(String(a.address).trim().toLowerCase());
      }
    }
  }
  return { hostname, ips, platform: os.platform(), arch: os.arch() };
}
