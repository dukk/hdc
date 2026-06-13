import {
  UPTIME_KUMA_PASSWORD_VAULT_KEY,
  UPTIME_KUMA_USERNAME_ENV,
} from "./vault-deps.mjs";

/** @typedef {{
 *   id: string;
 *   uptime_kuma_id: number | null;
 *   name: string;
 *   type: string;
 *   url: string | null;
 *   hostname: string | null;
 *   group: string | null;
 *   interval: number;
 *   ignore_tls: boolean;
 *   managed: boolean;
 *   notes: string | null;
 * }} ConfigMonitor */

/**
 * @param {unknown} v
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} value
 */
export function slugifyMonitorId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * @param {unknown} value
 */
export function parseUptimeKumaId(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const s = String(value ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {string} url
 */
export function shouldIgnoreTlsForUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.port === "8006") return true;
    return /^10\.\d+\.\d+\.\d+$/.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * @param {unknown} raw
 * @param {Record<string, unknown>} [defaults]
 * @param {Record<string, unknown>} [deployment]
 */
export function resolveUptimeKumaApiUrl(raw, defaults = {}, deployment = {}) {
  const auth = isObject(raw?.uptime_kuma_auth) ? raw.uptime_kuma_auth : {};
  if (typeof auth.api_url === "string" && auth.api_url.trim()) {
    return auth.api_url.trim().replace(/\/$/, "");
  }

  const defUk = isObject(defaults.uptime_kuma) ? defaults.uptime_kuma : {};
  const depUk = isObject(deployment.uptime_kuma) ? deployment.uptime_kuma : {};
  const port =
    typeof depUk.port === "number" && Number.isFinite(depUk.port)
      ? depUk.port
      : typeof defUk.port === "number" && Number.isFinite(defUk.port)
        ? defUk.port
        : Number(depUk.port) || Number(defUk.port) || 3001;

  const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
  const lxc = isObject(px.lxc) ? px.lxc : {};
  const ipConfig = typeof lxc.ip_config === "string" ? lxc.ip_config.trim() : "";
  const ipMatch = /^(\d+\.\d+\.\d+\.\d+)/.exec(ipConfig);
  if (ipMatch) {
    return `http://${ipMatch[1]}:${port}`;
  }

  const publicUrl =
    typeof depUk.public_url === "string" && depUk.public_url.trim()
      ? depUk.public_url.trim()
      : typeof defUk.public_url === "string" && defUk.public_url.trim()
        ? defUk.public_url.trim()
        : "";
  if (publicUrl) {
    try {
      const u = new URL(publicUrl);
      if (!u.port && port !== 443 && port !== 80) {
        u.port = String(port);
      }
      return u.origin;
    } catch {
      return publicUrl.replace(/\/$/, "");
    }
  }

  return null;
}

/**
 * @param {unknown} raw
 */
export function normalizeUptimeKumaMonitorConfig(raw) {
  const authRaw = isObject(raw?.uptime_kuma_auth) ? raw.uptime_kuma_auth : {};

  /** @type {ConfigMonitor[]} */
  const monitors = Array.isArray(raw?.monitors)
    ? raw.monitors
        .filter((m) => isObject(m) && typeof m.id === "string" && m.id.trim())
        .map((m) => ({
          id: String(m.id).trim(),
          uptime_kuma_id: parseUptimeKumaId(m.uptime_kuma_id),
          name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : String(m.id),
          type: String(m.type ?? "http").trim(),
          url: typeof m.url === "string" && m.url.trim() ? m.url.trim() : null,
          hostname: typeof m.hostname === "string" && m.hostname.trim() ? m.hostname.trim() : null,
          group: typeof m.group === "string" && m.group.trim() ? m.group.trim() : null,
          interval: Number(m.interval ?? 60) || 60,
          ignore_tls: m.ignore_tls === true,
          managed: m.managed === true,
          notes: typeof m.notes === "string" ? m.notes : null,
        }))
    : [];

  return {
    apiUrl: typeof authRaw.api_url === "string" && authRaw.api_url.trim() ? authRaw.api_url.trim() : null,
    usernameEnv:
      typeof authRaw.username_env === "string" && authRaw.username_env.trim()
        ? authRaw.username_env.trim()
        : UPTIME_KUMA_USERNAME_ENV,
    passwordVaultKey:
      typeof authRaw.password_vault_key === "string" && authRaw.password_vault_key.trim()
        ? authRaw.password_vault_key.trim()
        : UPTIME_KUMA_PASSWORD_VAULT_KEY,
    monitors,
    monitorsById: new Map(monitors.map((m) => [m.id, m])),
    monitorsByUptimeKumaId: new Map(
      monitors.filter((m) => m.uptime_kuma_id != null).map((m) => [/** @type {number} */ (m.uptime_kuma_id), m]),
    ),
  };
}

/**
 * @param {ConfigMonitor} cfg
 * @param {ConfigMonitor} live
 */
export function monitorHasDrift(cfg, live) {
  if ((cfg.uptime_kuma_id ?? null) !== (live.uptime_kuma_id ?? null)) return true;
  if (cfg.name !== live.name) return true;
  if (cfg.type !== live.type) return true;
  if ((cfg.url ?? null) !== (live.url ?? null)) return true;
  if ((cfg.hostname ?? null) !== (live.hostname ?? null)) return true;
  if (cfg.interval !== live.interval) return true;
  if (cfg.ignore_tls !== live.ignore_tls) return true;
  return false;
}

/**
 * @param {Record<string, unknown>} row
 * @param {ConfigMonitor | null} [existing]
 */
export function liveMonitorRowToConfig(row, existing = null) {
  const uptime_kuma_id = parseUptimeKumaId(row.id);
  if (uptime_kuma_id == null) return null;

  const type = typeof row.type === "string" ? row.type.trim() : "http";
  const name =
    typeof row.name === "string" && row.name.trim() ? row.name.trim() : `monitor-${uptime_kuma_id}`;

  return {
    id: existing?.id ?? slugifyMonitorId(name),
    uptime_kuma_id,
    name,
    type,
    url: typeof row.url === "string" && row.url.trim() ? row.url.trim() : null,
    hostname: typeof row.hostname === "string" && row.hostname.trim() ? row.hostname.trim() : null,
    group: existing?.group ?? null,
    interval: Number(row.interval ?? 60) || 60,
    ignore_tls: row.ignoreTls === true || row.ignore_tls === true,
    managed: existing?.managed ?? false,
    notes: existing?.notes ?? null,
  };
}

/**
 * @param {ConfigMonitor} entry
 * @param {boolean} [forEdit]
 */
export function monitorToSocketPayload(entry, forEdit = false) {
  /** @type {Record<string, unknown>} */
  const payload = {
    type: entry.type,
    name: entry.name,
    interval: entry.interval,
    retryInterval: 60,
    maxretries: 1,
    resendInterval: 0,
    upsideDown: false,
    notificationIDList: {},
    active: true,
    description: entry.group ? `Group: ${entry.group}` : entry.notes ?? "",
    httpBodyEncoding: "json",
  };

  if (forEdit && entry.uptime_kuma_id != null) {
    payload.id = entry.uptime_kuma_id;
  }

  if (entry.type === "http") {
    payload.url = entry.url ?? "";
    payload.method = "GET";
    payload.maxredirects = 10;
    payload.accepted_statuscodes = ["200-299"];
    payload.ignoreTls = entry.ignore_tls === true;
    payload.expiryNotification = false;
    payload.authMethod = "";
    payload.timeout = 48;
  } else if (entry.type === "ping") {
    payload.hostname = entry.hostname ?? "";
    payload.packetSize = 56;
  }

  return payload;
}

/**
 * @param {ConfigMonitor} entry
 */
export function validateConfigMonitor(entry) {
  if (!entry.id) throw new Error("monitor id is required");
  if (!entry.name) throw new Error(`monitor ${entry.id}: name is required`);
  if (entry.type === "http" && !entry.url) {
    throw new Error(`monitor ${entry.id}: url is required for type http`);
  }
  if (entry.type === "ping" && !entry.hostname) {
    throw new Error(`monitor ${entry.id}: hostname is required for type ping`);
  }
  if (!["http", "ping"].includes(entry.type)) {
    throw new Error(`monitor ${entry.id}: unsupported type ${entry.type}`);
  }
}
