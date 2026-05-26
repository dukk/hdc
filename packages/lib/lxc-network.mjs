const DEFAULT_GATEWAY = "10.0.0.1";
const DEFAULT_BRIDGE = "vmbr0";
const DEFAULT_IFACE = "eth0";

/**
 * @param {unknown} v
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} proxmox
 */
export function gatewayFromProxmox(proxmox) {
  if (!isObject(proxmox)) return DEFAULT_GATEWAY;
  const net = isObject(proxmox.network) ? proxmox.network : {};
  const gw = typeof net.gateway === "string" ? net.gateway.trim() : "";
  return gw || DEFAULT_GATEWAY;
}

/**
 * Resolve Proxmox LXC `ip=` value for net0 (null = DHCP / unset).
 * @param {Record<string, unknown>} lxc
 * @param {{ gateway?: string }} [opts]
 * @returns {string | null}
 */
export function resolveLxcIpConfig(lxc, opts = {}) {
  const gateway = (opts.gateway && opts.gateway.trim()) || DEFAULT_GATEWAY;
  const ipConfig = typeof lxc.ip_config === "string" ? lxc.ip_config.trim() : "";
  if (ipConfig) {
    if (/^dhcp$/i.test(ipConfig)) return null;
    return ipConfig;
  }
  const ipOnly = typeof lxc.ip === "string" ? lxc.ip.trim() : "";
  if (ipOnly) {
    if (/^dhcp$/i.test(ipOnly)) return null;
    if (/,/.test(ipOnly)) return ipOnly;
    return `${ipOnly},gw=${gateway}`;
  }
  return null;
}

/**
 * @param {string} bridge
 * @param {string} ipConfig Proxmox ip= value (e.g. 10.0.0.4/24,gw=10.0.0.1)
 * @param {string} [iface]
 */
export function buildNet0(bridge, ipConfig, iface = DEFAULT_IFACE) {
  const br = bridge.trim() || DEFAULT_BRIDGE;
  const ip = ipConfig.trim();
  return `name=${iface},bridge=${br},ip=${ip}`;
}

/**
 * Parse host IPv4 from ip_config or net0 string.
 * @param {string} value
 * @returns {string | null}
 */
export function parseIpv4FromIpConfig(value) {
  const s = String(value ?? "").trim();
  if (!s || /^dhcp$/i.test(s)) return null;
  const ipPart = s.split(",")[0]?.trim() ?? "";
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/\d+/.exec(ipPart);
  return m ? m[1] : null;
}

/**
 * Parse IPv4 from a Proxmox net0 line (name=eth0,bridge=vmbr0,ip=10.0.0.4/24,gw=…).
 * @param {string} net0
 */
export function parseIpv4FromNet0(net0) {
  const m = /(?:^|,)ip=([^,]+)/.exec(String(net0 ?? ""));
  return m ? parseIpv4FromIpConfig(m[1]) : null;
}
