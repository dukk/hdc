/** @typedef {{ type: string; name: string; data: string; ttl: number; proxied: boolean; priority?: number }} NormalizedRecord */

/** @typedef {{ name: string; records: NormalizedRecord[] }} ConfigZone */

/**
 * @param {unknown} v
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} zoneName
 */
export function normalizeZoneName(zoneName) {
  return String(zoneName).trim().toLowerCase().replace(/\.$/, "");
}

/**
 * @param {string} name
 * @param {string} zoneName
 */
export function normalizeRecordName(name, zoneName) {
  const z = normalizeZoneName(zoneName);
  let n = String(name ?? "").trim().toLowerCase();
  if (!n || n === "@" || n === z) return "@";
  if (n.endsWith(".")) n = n.slice(0, -1);
  const suffix = `.${z}`;
  if (n.endsWith(suffix)) n = n.slice(0, -suffix.length);
  if (!n || n === z) return "@";
  return n;
}

/**
 * @param {string} type
 * @param {string} data
 * @param {number | undefined} priority
 */
export function normalizeRecordData(type, data, priority) {
  let d = String(data ?? "").trim();
  if (d.endsWith(".")) d = d.slice(0, -1);
  const t = type.toUpperCase();
  if (t === "MX" && priority != null && Number.isFinite(priority)) {
    const withoutPri = d.replace(/^\d+\s+/, "");
    return `${priority} ${withoutPri}`.trim();
  }
  return d;
}

/**
 * @param {NormalizedRecord} rec
 * @param {string} zoneName
 */
export function recordMatchKey(rec, zoneName) {
  const type = rec.type.toUpperCase();
  const name = normalizeRecordName(rec.name, zoneName);
  const data = normalizeRecordData(type, rec.data, rec.priority);
  return `${type}|${name}|${data}`;
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function normalizeCloudflareConfig(cfg) {
  const cf = isObject(cfg.cloudflare) ? cfg.cloudflare : {};
  const defaults = isObject(cfg.defaults) ? cfg.defaults : {};
  const defaultTtl =
    typeof defaults.ttl === "number" && defaults.ttl >= 60 ? defaults.ttl : 300;
  const defaultProxied = defaults.proxied === true;

  const apiBase =
    typeof cf.api_base_url === "string" && cf.api_base_url.trim()
      ? cf.api_base_url.trim().replace(/\/$/, "")
      : "https://api.cloudflare.com/client/v4";

  let accountId = null;
  if (typeof cf.account_id === "string" && cf.account_id.trim()) {
    accountId = cf.account_id.trim();
  } else if (cf.account_id === null) {
    accountId = null;
  }

  const envAccount =
    typeof process.env.HDC_CLOUDFLARE_ACCOUNT_ID === "string" &&
    process.env.HDC_CLOUDFLARE_ACCOUNT_ID.trim()
      ? process.env.HDC_CLOUDFLARE_ACCOUNT_ID.trim()
      : null;
  if (!accountId && envAccount) accountId = envAccount;

  const filter = isObject(cf.zone_filter) ? cf.zone_filter : {};
  const modeRaw = typeof filter.mode === "string" ? filter.mode.trim().toLowerCase() : "all";
  const mode = modeRaw === "include" || modeRaw === "exclude" ? modeRaw : "all";
  const filterNames = Array.isArray(filter.names)
    ? filter.names.map((n) => normalizeZoneName(String(n))).filter(Boolean)
    : [];

  /** @type {ConfigZone[]} */
  const zones = [];
  const zoneList = Array.isArray(cfg.zones) ? cfg.zones : [];
  for (const z of zoneList) {
    if (!isObject(z)) continue;
    const name = normalizeZoneName(typeof z.name === "string" ? z.name : "");
    if (!name) continue;
    /** @type {NormalizedRecord[]} */
    const records = [];
    const recs = Array.isArray(z.records) ? z.records : [];
    for (const r of recs) {
      if (!isObject(r)) continue;
      const type = typeof r.type === "string" ? r.type.trim().toUpperCase() : "";
      const data = typeof r.data === "string" ? r.data.trim() : "";
      if (!type || !data) continue;
      const recName = normalizeRecordName(typeof r.name === "string" ? r.name : "@", name);
      const ttl =
        typeof r.ttl === "number" && r.ttl >= 60
          ? r.ttl
          : typeof r.ttl === "number" && r.ttl === 1
            ? 1
            : defaultTtl;
      const proxied = r.proxied === true || (r.proxied !== false && defaultProxied);
      /** @type {NormalizedRecord} */
      const rec = {
        type,
        name: recName,
        data: normalizeRecordData(type, data, typeof r.priority === "number" ? r.priority : undefined),
        ttl,
        proxied: ["A", "AAAA", "CNAME"].includes(type) ? proxied : false,
      };
      if (type === "MX" && typeof r.priority === "number") rec.priority = r.priority;
      records.push(rec);
    }
    zones.push({ name, records });
  }

  return {
    apiBase,
    accountId,
    zoneFilter: { mode, names: filterNames },
    zones,
    zonesByName: new Map(zones.map((z) => [z.name, z])),
  };
}

/**
 * @param {string} zoneName
 * @param {{ mode: string; names: string[] }} zoneFilter
 */
export function zonePassesFilter(zoneName, zoneFilter) {
  const n = normalizeZoneName(zoneName);
  if (zoneFilter.mode === "include") {
    return zoneFilter.names.length > 0 && zoneFilter.names.includes(n);
  }
  if (zoneFilter.mode === "exclude") {
    return !zoneFilter.names.includes(n);
  }
  return true;
}

/**
 * @param {import('./cloudflare-api.mjs').CfDnsRecord} live
 * @param {string} zoneName
 * @returns {NormalizedRecord}
 */
export function liveRecordToNormalized(live, zoneName) {
  const type = live.type.toUpperCase();
  return {
    type,
    name: normalizeRecordName(live.name, zoneName),
    data: normalizeRecordData(type, live.content, live.priority),
    ttl: live.ttl,
    proxied: Boolean(live.proxied),
    priority: live.priority,
  };
}

/**
 * @param {NormalizedRecord} rec
 * @param {string} zoneName
 * @returns {Record<string, unknown>}
 */
export function normalizedToApiBody(rec, zoneName) {
  const z = normalizeZoneName(zoneName);
  const name = rec.name === "@" ? z : `${rec.name}.${z}`;
  /** @type {Record<string, unknown>} */
  const body = {
    type: rec.type,
    name,
    ttl: rec.ttl,
  };
  if (rec.type === "MX") {
    const m = rec.data.match(/^(\d+)\s+(.+)$/);
    body.priority = rec.priority ?? (m ? Number(m[1]) : 10);
    body.content = m ? m[2].trim() : rec.data.trim();
  } else {
    body.content = rec.data.trim();
  }
  if (["A", "AAAA", "CNAME"].includes(rec.type)) {
    body.proxied = rec.proxied;
  }
  return body;
}

/**
 * @param {NormalizedRecord} desired
 * @param {NormalizedRecord} live
 */
export function recordsNeedUpdate(desired, live) {
  if (desired.ttl !== live.ttl) return true;
  if (["A", "AAAA", "CNAME"].includes(desired.type) && desired.proxied !== live.proxied) return true;
  if (desired.type === "MX" && desired.priority !== live.priority) return true;
  return false;
}
