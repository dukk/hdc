/**
 * Pure IPv4 helpers for agent mailbox / block decisions.
 * Kept in-tree so fleet containers do not need hdc-clumps on the image.
 */

/** Default site CIDRs that must never be blocked (from ip-allocations.md). */
export const DEFAULT_NEVER_BLOCK_CIDRS = Object.freeze([
  "10.0.0.0/24",
  "10.0.5.0/26",
  "10.1.0.0/26",
  "10.1.1.0/26",
  "10.1.3.0/26",
  "10.2.0.0/26",
  "10.2.1.0/27",
  "10.2.2.0/26",
  "10.2.9.0/27",
  "192.168.12.0/24",
  "192.168.100.0/24",
  "127.0.0.0/8",
  "::1/128",
]);

/**
 * @param {string} ip
 * @returns {boolean}
 */
export function isValidIpv4(ip) {
  const parts = String(ip).trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/** @param {string} ip */
function ipv4ToInt(ip) {
  const [a, b, c, d] = ip.split(".").map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/**
 * @param {string} ip
 * @param {string} cidr e.g. 10.0.0.0/24
 */
export function ipv4InCidr(ip, cidr) {
  const [net, bitsStr] = String(cidr).split("/");
  const bits = Number(bitsStr);
  if (!isValidIpv4(ip) || !isValidIpv4(net) || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const ipN = ipv4ToInt(ip);
  const netN = ipv4ToInt(net);
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipN & mask) === (netN & mask);
}

/**
 * @param {string} ip
 * @param {string[]} cidrs
 */
export function isInternalIp(ip, cidrs = DEFAULT_NEVER_BLOCK_CIDRS) {
  const trimmed = String(ip).trim();
  if (!isValidIpv4(trimmed)) return true;
  return cidrs.some((c) => ipv4InCidr(trimmed, c));
}
