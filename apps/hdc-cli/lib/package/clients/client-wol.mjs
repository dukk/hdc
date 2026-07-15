import { createSocket } from "node:dgram";

import { normalizeMac } from "./client-config.mjs";
import { isHostOnline } from "./client-reachability.mjs";

/**
 * @param {string} macColon
 */
export function buildMagicPacket(macColon) {
  const hex = macColon.replace(/:/g, "");
  const macBytes = Buffer.from(hex, "hex");
  if (macBytes.length !== 6) throw new Error("invalid MAC for magic packet");
  const buf = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) {
    macBytes.copy(buf, 6 + i * 6);
  }
  return buf;
}

/**
 * @param {object} opts
 * @param {string} opts.mac
 * @param {string} opts.broadcast
 * @param {number} opts.port
 * @param {number} opts.packets
 */
export function sendWakeOnLan(opts) {
  const mac = normalizeMac(opts.mac);
  if (!mac) throw new Error("invalid MAC for WoL");
  const packet = buildMagicPacket(mac);
  const socket = createSocket("udp4");
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        for (let i = 0; i < opts.packets; i++) {
          socket.send(packet, opts.port, opts.broadcast);
        }
        socket.close();
        resolve({ mac, broadcast: opts.broadcast, port: opts.port, packets: opts.packets });
      } catch (e) {
        socket.close();
        reject(e);
      }
    });
  });
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {number} opts.waitSeconds
 * @param {number} opts.pollIntervalSeconds
 * @param {(msg: string) => void} [opts.log]
 */
export async function waitForReachable(opts) {
  const { host, port, waitSeconds, pollIntervalSeconds, log } = opts;
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    if (await isHostOnline(host, port)) return true;
    log?.(`[wol] waiting for ${host}:${port} …`);
    await new Promise((r) => setTimeout(r, pollIntervalSeconds * 1000));
  }
  return false;
}
