import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, stderr as errout, env } from "node:process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
import https from "node:https";
import http from "node:http";

import {
  findInventorySidecars,
  automatedInventoryIdFromName,
  mergeAutomatedSidecarFromTarget,
  mergeAutomatedSystemsFromPlugin,
  migrateAutomatedSidecarsToNameSlugs,
  migrateLegacyVendorPrefixedSidecars,
  pruneAutomatedSidecarSourceForTarget,
  pruneAutomatedSidecarsWithIdPrefix,
  readAutomatedPluginMeta,
  sanitizeAutomatedInventoryId,
  writeAutomatedSidecar,
} from "../../../tools/hdc/inventory.mjs";
import { createVaultAccess, vaultDepsFromCli } from "../../../tools/hdc/lib/vault-access.mjs";
import { readLineMasked } from "../../../tools/hdc/lib/readline-masked.mjs";
import {
  HDC_TLS_INSECURE_ENV,
  hdcTlsInsecureSourceEnv,
  hdcTlsRejectUnauthorized,
} from "../../../tools/hdc/lib/tls-insecure-env.mjs";
import { defaultVaultPath } from "../../../tools/hdc/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const repoRoot = join(here, "..", "..", "..");

const VAULT_KEY = "HDC_UNIFI_NETWORK_API_KEY";
const SPEC_TLS_INSECURE = "HDC_UNIFI_TLS_INSECURE";

/** @param {string} line */
function logUser(line) {
  errout.write(`[unifi-network] ${line}\n`);
}

/** @param {string} root @param {string} abs */
function relFromRoot(root, abs) {
  try {
    return relative(root, abs).replace(/\\/g, "/");
  } catch {
    return abs;
  }
}

/** @param {string} s */
function baseUrlFromString(s) {
  const trimmed = s.trim();
  const withProto = /:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  const u = new URL(withProto);
  return `${u.protocol}//${u.host}`;
}

/**
 * @param {string} root
 * @returns {{ url: string; provenance: string } | null}
 */
function readStoredControllerBase(root) {
  const fromSources = readAutomatedPluginMeta(root, target);
  if (fromSources) {
    return {
      url: baseUrlFromString(fromSources),
      provenance: "inventory/manual/targets/unifi-network.json (controller_base_url)",
    };
  }
  const legacy = join(root, "inventory", "automated", "network.json");
  if (!existsSync(legacy)) return null;
  try {
    const j = JSON.parse(readFileSync(legacy, "utf8"));
    const u =
      (j.unifi && typeof j.unifi.controller_base_url === "string" && j.unifi.controller_base_url) ||
      (typeof j.controller_base_url === "string" && j.controller_base_url);
    if (u && u.trim()) {
      return {
        url: baseUrlFromString(u),
        provenance: `${relFromRoot(root, legacy)} (legacy unifi.controller_base_url)`,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} collectedAt
 */
function unifiSidecarBase(id, kind) {
  return {
    schema_version: 1,
    id,
    kind,
    tags: ["unifi", "automated"],
  };
}

/** @param {string} collectedAt */
function systemSidecarBase(id, collectedAt) {
  return {
    ...unifiSidecarBase(id, "system"),
    automation_targets: [target],
    last_verified: collectedAt,
    _automated_source: target,
    _automated_at: collectedAt,
  };
}

/**
 * @param {Record<string, unknown>} row
 * @param {Set<string>} usedIds
 */
function buildUnifiNetworkSidecar(row, usedIds) {
  const id = automatedInventoryIdFromName("net", row, usedIds);
  return {
    ...unifiSidecarBase(id, "network"),
    query_last: row,
  };
}

/**
 * Normalize integration or classic station rows to a common client shape.
 * @param {Record<string, unknown>} row
 */
function normalizeClientRow(row) {
  /** @type {Record<string, unknown>} */
  const o = { ...row };
  if (typeof o.macAddress !== "string" || !o.macAddress.trim()) {
    if (typeof o.mac === "string" && o.mac.trim()) o.macAddress = o.mac.trim();
  }
  if (typeof o.ipAddress !== "string" || !o.ipAddress.trim()) {
    if (typeof o.ip === "string" && o.ip.trim()) o.ipAddress = o.ip.trim();
    else if (typeof o.last_ip === "string" && o.last_ip.trim()) o.ipAddress = o.last_ip.trim();
  }
  if (typeof o.name !== "string" || !o.name.trim()) {
    if (typeof o.hostname === "string" && o.hostname.trim()) o.name = o.hostname.trim();
    else if (typeof o.host_name === "string" && o.host_name.trim()) o.name = o.host_name.trim();
  }
  if (typeof o.id !== "string" || !o.id.trim()) {
    if (typeof o.macAddress === "string" && o.macAddress.trim()) o.id = o.macAddress.trim();
  }
  if (typeof o.type !== "string" || !o.type.trim()) {
    if (o.is_wired === true) o.type = "WIRED";
    else if (o.is_wireless === true) o.type = "WIRELESS";
  }
  return o;
}

/**
 * @param {Record<string, unknown>[]} integrationRows
 * @param {Record<string, unknown>[]} classicRows
 */
function mergeClientRowsByMac(integrationRows, classicRows) {
  /** @type {Map<string, Record<string, unknown>>} */
  const byMac = new Map();
  const add = (/** @type {Record<string, unknown>} */ raw, /** @type {boolean} */ fillGaps) => {
    const n = normalizeClientRow(raw);
    const mac = typeof n.macAddress === "string" ? n.macAddress.trim().toLowerCase() : "";
    if (!mac) return;
    const prev = byMac.get(mac);
    if (!prev) {
      byMac.set(mac, n);
      return;
    }
    byMac.set(mac, fillGaps ? { ...n, ...prev } : { ...prev, ...n });
  };
  for (const r of classicRows) add(r, true);
  for (const r of integrationRows) add(r, false);
  return [...byMac.values()];
}

/**
 * @param {Record<string, unknown>} row normalized client row
 * @param {string} collectedAt
 * @param {Set<string>} usedIds
 */
function buildClientSystemSidecar(row, collectedAt, usedIds) {
  const mac = typeof row.macAddress === "string" ? row.macAddress.trim() : "";
  const displayName = typeof row.name === "string" ? row.name.trim() : "";
  let id;
  if (displayName) {
    id = automatedInventoryIdFromName("sys", row, usedIds);
  } else if (mac) {
    id = `sys-${sanitizeAutomatedInventoryId(mac)}`;
    usedIds.add(id);
  } else {
    id = automatedInventoryIdFromName("sys", { name: "unknown-client" }, usedIds);
  }
  const nodeName = displayName || id;
  /** @type {Record<string, unknown>} */
  const node = { name: nodeName };
  if (typeof row.ipAddress === "string" && row.ipAddress.trim()) node.ip = row.ipAddress.trim();
  if (mac) node.mac = mac;
  const entry = inventoryClientEntry({ ...row, collected_at: collectedAt }, collectedAt);
  return {
    schema_version: 1,
    id,
    kind: "system",
    tags: ["unifi", "automated", "unifi-client"],
    access: { nodes: [node] },
    query_last: entry,
  };
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} collectedAt
 * @param {string} roleTag
 */
function buildUnifiSystemSidecar(row, collectedAt, roleTag) {
  const rawId =
    typeof row.id === "string"
      ? row.id
      : typeof row._id === "string"
        ? row._id
        : typeof row.macAddress === "string"
          ? row.macAddress
          : "unknown";
  const id = `unifi-${roleTag}-${sanitizeAutomatedInventoryId(String(rawId))}`;
  const name = typeof row.name === "string" ? row.name : id;
  const ip = typeof row.ipAddress === "string" ? row.ipAddress : "";
  const mac = typeof row.macAddress === "string" ? row.macAddress : "";
  /** @type {Record<string, unknown>} */
  const node = { name };
  if (ip) node.ip = ip;
  if (mac) node.mac = mac;
  return {
    ...systemSidecarBase(id, collectedAt),
    tags: ["unifi", "automated", roleTag],
    access: { nodes: [node] },
    query_last: row,
  };
}

/**
 * @param {Record<string, unknown>} row
 * @param {"firewall_policy" | "port_forward"} policyClass
 * @param {Set<string>} usedIds
 */
function buildUnifiPolicySidecar(row, policyClass, usedIds) {
  const prefix = policyClass === "port_forward" ? "pf" : "fw";
  const id = automatedInventoryIdFromName(prefix, row, usedIds);
  return {
    ...unifiSidecarBase(id, "policy"),
    policy_class: policyClass,
    query_last: row,
  };
}

/**
 * @param {string} root
 * @returns {{ url: string; provenance: string } | null}
 */
function discoverControllerFromManualInventory(root) {
  for (const p of findInventorySidecars(root)) {
    let data;
    try {
      data = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    if (!data || typeof data !== "object") continue;
    const id = typeof data.id === "string" ? data.id : "";
    const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t)) : [];
    const targets = Array.isArray(data.automation_targets) ? data.automation_targets.map(String) : [];
    const isUnifi =
      targets.includes("unifi-network") ||
      tags.some((t) => /unifi/i.test(t)) ||
      /unifi/i.test(id);
    if (!isUnifi) continue;

    const nodes = data.access && typeof data.access === "object" ? data.access.nodes : null;
    if (!Array.isArray(nodes)) continue;
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      const web = typeof n.web_ui === "string" ? n.web_ui.trim() : "";
      const ip = typeof n.ip === "string" ? n.ip.trim() : "";
      const rel = relFromRoot(root, p);
      if (web) return { url: baseUrlFromString(web), provenance: `${rel} (access.nodes[].web_ui)` };
      if (ip) return { url: baseUrlFromString(`https://${ip}`), provenance: `${rel} (access.nodes[].ip → https)` };
    }
  }
  return null;
}

/**
 * @param {import("node:https").RequestOptions & { url: string }} opts
 */
function requestJson(opts) {
  const { url, ...rest } = opts;
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const lib = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || defaultPort,
        path: `${u.pathname}${u.search}`,
        method: rest.method ?? "GET",
        headers: rest.headers ?? {},
        rejectUnauthorized: isHttps ? rest.rejectUnauthorized !== false : undefined,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => {
          /** @type {unknown} */
          let parsed;
          try {
            parsed = raw.length ? JSON.parse(raw) : null;
          } catch (e) {
            reject(new Error(`Invalid JSON from ${url} (${res.statusCode}): ${String(e)}`));
            return;
          }
          if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`HTTP ${res.statusCode} ${url}`);
            // @ts-expect-error attach
            err.statusCode = res.statusCode;
            // @ts-expect-error attach
            err.body = parsed;
            reject(err);
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.on("error", reject);
    if (rest.body) req.write(rest.body);
    req.end();
  });
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {boolean} rejectUnauthorized
 */
async function integrationInfo(base, apiKey, rejectUnauthorized) {
  const url = `${base}/proxy/network/integration/v1/info`;
  return requestJson({
    url,
    headers: {
      Accept: "application/json",
      "X-API-KEY": apiKey,
    },
    rejectUnauthorized,
  });
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {boolean} rejectUnauthorized
 */
async function integrationListSites(base, apiKey, rejectUnauthorized) {
  const url = `${base}/proxy/network/integration/v1/sites?limit=200&offset=0`;
  return requestJson({
    url,
    headers: {
      Accept: "application/json",
      "X-API-KEY": apiKey,
    },
    rejectUnauthorized,
  });
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 */
async function classicNetworkconf(base, apiKey, siteId, rejectUnauthorized) {
  const pathSeg = encodeURIComponent(siteId);
  const url = `${base}/proxy/network/api/s/${pathSeg}/rest/networkconf`;
  return requestJson({
    url,
    headers: {
      Accept: "application/json",
      "X-API-KEY": apiKey,
    },
    rejectUnauthorized,
  });
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>[]}
 */
function integrationPageData(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const data = /** @type {Record<string, unknown>} */ (body).data;
  if (!Array.isArray(data)) return [];
  return data.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map((x) => /** @type {Record<string, unknown>} */ (x));
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} urlPath path after /proxy/network/integration/v1 (no leading slash)
 * @param {boolean} rejectUnauthorized
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function integrationPaginatedGet(base, apiKey, urlPath, rejectUnauthorized) {
  /** @type {Record<string, unknown>[]} */
  const all = [];
  let offset = 0;
  const limit = 200;
  for (;;) {
    const sep = urlPath.includes("?") ? "&" : "?";
    const url = `${base}/proxy/network/integration/v1/${urlPath}${sep}offset=${offset}&limit=${limit}`;
    const body = await requestJson({
      url,
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
      rejectUnauthorized,
    });
    const chunk = integrationPageData(body);
    all.push(...chunk);
    const totalCount =
      body && typeof body === "object" && !Array.isArray(body) && typeof body.totalCount === "number"
        ? body.totalCount
        : chunk.length;
    if (chunk.length < limit || all.length >= totalCount) break;
    offset += limit;
  }
  return all;
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function integrationListAllNetworkOverviews(base, apiKey, siteId, rejectUnauthorized) {
  return integrationPaginatedGet(
    base,
    apiKey,
    `sites/${encodeURIComponent(siteId)}/networks`,
    rejectUnauthorized,
  );
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 */
async function integrationListAllDevices(base, apiKey, siteId, rejectUnauthorized) {
  return integrationPaginatedGet(
    base,
    apiKey,
    `sites/${encodeURIComponent(siteId)}/devices`,
    rejectUnauthorized,
  );
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 */
async function integrationListAllClients(base, apiKey, siteId, rejectUnauthorized) {
  return integrationPaginatedGet(
    base,
    apiKey,
    `sites/${encodeURIComponent(siteId)}/clients`,
    rejectUnauthorized,
  );
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {boolean} rejectUnauthorized
 */
async function integrationListPendingDevices(base, apiKey, rejectUnauthorized) {
  return integrationPaginatedGet(base, apiKey, "pending-devices", rejectUnauthorized);
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 */
async function integrationListFirewallPolicies(base, apiKey, siteId, rejectUnauthorized) {
  return integrationPaginatedGet(
    base,
    apiKey,
    `sites/${encodeURIComponent(siteId)}/firewall/policies`,
    rejectUnauthorized,
  );
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 */
async function integrationListFirewallZones(base, apiKey, siteId, rejectUnauthorized) {
  return integrationPaginatedGet(
    base,
    apiKey,
    `sites/${encodeURIComponent(siteId)}/firewall/zones`,
    rejectUnauthorized,
  );
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {string} resource classic rest segment (e.g. portforward)
 * @param {boolean} rejectUnauthorized
 */
async function classicRestList(base, apiKey, siteId, resource, rejectUnauthorized) {
  const pathSeg = encodeURIComponent(siteId);
  const url = `${base}/proxy/network/api/s/${pathSeg}/rest/${resource}`;
  const body = await requestJson({
    url,
    headers: {
      Accept: "application/json",
      "X-API-KEY": apiKey,
    },
    rejectUnauthorized,
  });
  return classicDataArray(body);
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 * @returns {Promise<{ rows: Record<string, unknown>[]; siteKey: string }>}
 */
async function classicPortForwards(base, apiKey, siteId, rejectUnauthorized) {
  let rows = await classicRestList(base, apiKey, siteId, "portforward", rejectUnauthorized);
  let siteKey = siteId;
  if (!rows.length && siteId !== "default") {
    rows = await classicRestList(base, apiKey, "default", "portforward", rejectUnauthorized);
    if (rows.length) siteKey = "default";
  }
  return { rows, siteKey };
}

/**
 * Active stations via classic API (often populated when Integration clients list is empty).
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 */
async function classicActiveStations(base, apiKey, siteId, rejectUnauthorized) {
  const pathSeg = encodeURIComponent(siteId);
  const url = `${base}/proxy/network/api/s/${pathSeg}/stat/sta`;
  const body = await requestJson({
    url,
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: "{}",
    rejectUnauthorized,
  });
  return classicDataArray(body);
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 */
async function listConnectedClients(base, apiKey, siteId, rejectUnauthorized) {
  /** @type {Record<string, unknown>[]} */
  let integrationRows = [];
  try {
    integrationRows = await integrationListAllClients(base, apiKey, siteId, rejectUnauthorized);
  } catch (e) {
    errout.write(`[unifi-network] Integration client list failed (${/** @type {Error} */ (e).message}).\n`);
  }

  /** @type {Record<string, unknown>[]} */
  let classicRows = [];
  try {
    classicRows = await classicActiveStations(base, apiKey, siteId, rejectUnauthorized);
    if (!classicRows.length && siteId !== "default") {
      classicRows = await classicActiveStations(base, apiKey, "default", rejectUnauthorized);
    }
  } catch (e) {
    errout.write(`[unifi-network] Classic stat/sta failed (${/** @type {Error} */ (e).message}).\n`);
  }

  const merged = mergeClientRowsByMac(integrationRows, classicRows);
  if (integrationRows.length && classicRows.length && merged.length > integrationRows.length) {
    logUser(
      `Merged ${integrationRows.length} integration client(s) with classic stat/sta (${classicRows.length} row(s)) → ${merged.length} unique by MAC.`,
    );
  } else if (!integrationRows.length && classicRows.length) {
    logUser(`Using ${merged.length} client(s) from classic stat/sta (integration list was empty).`);
  }
  return merged;
}

/**
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {string} netId
 * @param {boolean} rejectUnauthorized
 */
async function integrationNetworkDetail(base, apiKey, siteId, netId, rejectUnauthorized) {
  const url = `${base}/proxy/network/integration/v1/sites/${encodeURIComponent(siteId)}/networks/${encodeURIComponent(netId)}`;
  return requestJson({
    url,
    headers: {
      Accept: "application/json",
      "X-API-KEY": apiKey,
    },
    rejectUnauthorized,
  });
}

const CLASSIC_EXPORT_KEYS = new Set([
  "_id",
  "name",
  "purpose",
  "vlan",
  "vlan_enabled",
  "enabled",
  "ip_subnet",
  "dhcpd_enabled",
  "dhcpd_start",
  "dhcpd_stop",
  "dhcpd_gateway",
  "dhcpd_ip_1",
  "dhcpd_ip_2",
  "dhcpd_ip_3",
  "domain_name",
  "dhcpd_dns_enabled",
  "dhcp_relay_server",
  "dhcpd_leasetime",
  "dhcpdv6_enabled",
  "dhcpd_wins_enabled",
  "dhcpd_wins_server",
  "ipv6_interface_type",
  "ipv6_ra_enabled",
  "networkgroup",
]);

/**
 * @param {Record<string, unknown>} n
 */
function sanitizeClassicRow(n) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of CLASSIC_EXPORT_KEYS) {
    if (n[k] !== undefined) out[k] = n[k];
  }
  return out;
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>[]}
 */
function classicDataArray(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const o = /** @type {Record<string, unknown>} */ (body);
  const meta = o.meta && typeof o.meta === "object" && !Array.isArray(o.meta) ? o.meta : null;
  const rc = meta && typeof meta.rc === "string" ? meta.rc : "";
  if (rc !== "ok") return [];
  const data = o.data;
  if (!Array.isArray(data)) return [];
  return data.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map((x) => /** @type {Record<string, unknown>} */ (x));
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} collectedAt
 */
function inventoryNetworkEntry(row, collectedAt) {
  const dns = [row.dhcpd_ip_1, row.dhcpd_ip_2, row.dhcpd_ip_3].filter((x) => typeof x === "string" && x.trim());
  return {
    ...sanitizeClassicRow(row),
    dns_servers: dns,
    collected_at: collectedAt,
  };
}

/**
 * @param {Record<string, unknown>} row
 */
function formatNetworkBlock(row) {
  const lines = [];
  const name = typeof row.name === "string" ? row.name : "(unnamed)";
  const purpose = typeof row.purpose === "string" ? row.purpose : "";
  lines.push(`— ${name}${purpose ? ` [${purpose}]` : ""}`);
  if (row.vlan !== undefined) lines.push(`  VLAN: ${String(row.vlan)} (vlan_enabled: ${String(row.vlan_enabled ?? "")})`);
  if (typeof row.ip_subnet === "string" && row.ip_subnet) lines.push(`  Subnet / CIDR: ${row.ip_subnet}`);
  if (row.dhcpd_enabled !== undefined) lines.push(`  DHCP server: ${row.dhcpd_enabled ? "on" : "off"}`);
  if (typeof row.dhcpd_start === "string" && typeof row.dhcpd_stop === "string") {
    lines.push(`  DHCP pool: ${row.dhcpd_start} – ${row.dhcpd_stop}`);
  }
  if (typeof row.dhcpd_gateway === "string" && row.dhcpd_gateway) lines.push(`  DHCP gateway: ${row.dhcpd_gateway}`);
  const dns = [row.dhcpd_ip_1, row.dhcpd_ip_2, row.dhcpd_ip_3].filter((x) => typeof x === "string" && x.trim());
  if (dns.length) lines.push(`  DNS (DHCP options): ${dns.join(", ")}`);
  if (typeof row.domain_name === "string" && row.domain_name) lines.push(`  Domain: ${row.domain_name}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} merged
 */
function formatIntegrationNetworkBlock(merged) {
  const lines = [];
  const name = typeof merged.name === "string" ? merged.name : "(unnamed)";
  lines.push(`— ${name} (Integration API — no L3/DNS in this view)`);
  lines.push(`  id: ${String(merged.id ?? "")}`);
  if (merged.vlanId !== undefined) lines.push(`  vlanId: ${String(merged.vlanId)}`);
  if (merged.management !== undefined) lines.push(`  management: ${String(merged.management)}`);
  if (merged.enabled !== undefined) lines.push(`  enabled: ${String(merged.enabled)}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} overview
 * @param {Record<string, unknown>} detail
 * @param {string} collectedAt
 */
function inventoryIntegrationNetworkEntry(overview, detail, collectedAt) {
  const o = overview && typeof overview === "object" ? overview : {};
  const d = detail && typeof detail === "object" ? detail : {};
  return {
    source_api: "integration",
    id: typeof o.id === "string" ? o.id : typeof d.id === "string" ? d.id : null,
    name: typeof o.name === "string" ? o.name : typeof d.name === "string" ? d.name : null,
    enabled: typeof o.enabled === "boolean" ? o.enabled : typeof d.enabled === "boolean" ? d.enabled : null,
    vlanId: typeof o.vlanId === "number" ? o.vlanId : typeof d.vlanId === "number" ? d.vlanId : o.vlanId ?? d.vlanId,
    management: typeof o.management === "string" ? o.management : typeof d.management === "string" ? d.management : null,
    metadata: d.metadata ?? o.metadata ?? null,
    collected_at: collectedAt,
  };
}

const DEVICE_EXPORT_KEYS = new Set([
  "id",
  "macAddress",
  "ipAddress",
  "name",
  "model",
  "state",
  "supported",
  "firmwareVersion",
  "firmwareUpdatable",
  "features",
  "interfaces",
]);

const CLIENT_EXPORT_KEYS = new Set([
  "id",
  "type",
  "name",
  "macAddress",
  "ipAddress",
  "connectedAt",
  "access",
  "uplinkDeviceId",
]);

const PENDING_DEVICE_EXPORT_KEYS = new Set([
  "macAddress",
  "ipAddress",
  "model",
  "state",
  "supported",
  "firmwareVersion",
  "firmwareUpdatable",
  "features",
]);

/**
 * @param {Record<string, unknown>} row
 * @param {Set<string>} keys
 */
function pickFields(row, keys) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of keys) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  return out;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} collectedAt
 */
function inventoryDeviceEntry(row, collectedAt) {
  return { ...pickFields(row, DEVICE_EXPORT_KEYS), collected_at: collectedAt };
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} collectedAt
 */
function inventoryClientEntry(row, collectedAt) {
  return { ...pickFields(row, CLIENT_EXPORT_KEYS), collected_at: collectedAt };
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} collectedAt
 */
function inventoryPendingDeviceEntry(row, collectedAt) {
  return { ...pickFields(row, PENDING_DEVICE_EXPORT_KEYS), collected_at: collectedAt };
}

/**
 * @param {Record<string, unknown>} row
 */
function formatDeviceBlock(row) {
  const lines = [];
  const name = typeof row.name === "string" ? row.name : "(unnamed)";
  const model = typeof row.model === "string" ? row.model : "";
  const state = typeof row.state === "string" ? row.state : "";
  lines.push(`— ${name}${model ? ` (${model})` : ""}${state ? ` · ${state}` : ""}`);
  if (typeof row.ipAddress === "string" && row.ipAddress) lines.push(`  IP: ${row.ipAddress}`);
  if (typeof row.macAddress === "string" && row.macAddress) lines.push(`  MAC: ${row.macAddress}`);
  if (typeof row.firmwareVersion === "string" && row.firmwareVersion) {
    const upd = row.firmwareUpdatable ? " (update available)" : "";
    lines.push(`  Firmware: ${row.firmwareVersion}${upd}`);
  }
  if (Array.isArray(row.features) && row.features.length) lines.push(`  Features: ${row.features.join(", ")}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} row
 */
function formatClientBlock(row) {
  const lines = [];
  const name = typeof row.name === "string" ? row.name : "(unnamed)";
  const type = typeof row.type === "string" ? row.type : "";
  lines.push(`— ${name}${type ? ` [${type}]` : ""}`);
  if (typeof row.ipAddress === "string" && row.ipAddress) lines.push(`  IP: ${row.ipAddress}`);
  if (typeof row.macAddress === "string" && row.macAddress) lines.push(`  MAC: ${row.macAddress}`);
  if (typeof row.connectedAt === "string" && row.connectedAt) lines.push(`  Connected: ${row.connectedAt}`);
  const access = row.access && typeof row.access === "object" && !Array.isArray(row.access) ? row.access : null;
  if (access && typeof access.type === "string") {
    const auth = typeof access.authorized === "boolean" ? ` authorized=${access.authorized}` : "";
    lines.push(`  Access: ${access.type}${auth}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} row
 */
function formatPendingDeviceBlock(row) {
  const lines = [];
  const model = typeof row.model === "string" ? row.model : "";
  const state = typeof row.state === "string" ? row.state : "";
  const label = typeof row.macAddress === "string" ? row.macAddress : "(unknown)";
  lines.push(`— ${label}${model ? ` (${model})` : ""}${state ? ` · ${state}` : ""}`);
  if (typeof row.ipAddress === "string" && row.ipAddress) lines.push(`  IP: ${row.ipAddress}`);
  lines.push("");
  return lines.join("\n");
}

const FIREWALL_ZONE_EXPORT_KEYS = new Set(["id", "name", "networkIds", "metadata"]);

const FIREWALL_POLICY_EXPORT_KEYS = new Set([
  "id",
  "enabled",
  "name",
  "description",
  "index",
  "action",
  "source",
  "destination",
  "ipProtocolScope",
  "connectionStateFilter",
  "ipsecFilter",
  "loggingEnabled",
  "schedule",
  "metadata",
]);

const PORT_FORWARD_EXPORT_KEYS = new Set([
  "_id",
  "name",
  "enabled",
  "rule_index",
  "pfwd_interface",
  "proto",
  "dst_port",
  "fwd",
  "fwd_port",
  "log",
  "src",
  "src_port",
  "src_firewall_group_id",
  "dst_firewall_group_id",
]);

/**
 * @param {Record<string, unknown>[]} zones
 * @returns {Map<string, string>}
 */
function firewallZoneNameMap(zones) {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const z of zones) {
    const id = typeof z.id === "string" ? z.id : "";
    const name = typeof z.name === "string" ? z.name : "";
    if (id && name) m.set(id, name);
  }
  return m;
}

/**
 * @param {unknown} endpoint
 * @param {Map<string, string>} zoneMap
 */
function formatFirewallEndpoint(endpoint, zoneMap) {
  if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) return "?";
  const ep = /** @type {Record<string, unknown>} */ (endpoint);
  const zid = typeof ep.firewallZoneId === "string" ? ep.firewallZoneId : "";
  if (zid && zoneMap.has(zid)) return zoneMap.get(zid) ?? zid;
  return zid || "?";
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} collectedAt
 */
function inventoryFirewallZoneEntry(row, collectedAt) {
  return { ...pickFields(row, FIREWALL_ZONE_EXPORT_KEYS), collected_at: collectedAt };
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} collectedAt
 */
function inventoryFirewallPolicyEntry(row, collectedAt) {
  return { ...pickFields(row, FIREWALL_POLICY_EXPORT_KEYS), collected_at: collectedAt };
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} collectedAt
 */
function inventoryPortForwardEntry(row, collectedAt) {
  return { ...pickFields(row, PORT_FORWARD_EXPORT_KEYS), collected_at: collectedAt };
}

/**
 * @param {Record<string, unknown>} row
 * @param {Map<string, string>} zoneMap
 */
function formatFirewallPolicyBlock(row, zoneMap) {
  const lines = [];
  const name = typeof row.name === "string" ? row.name : "(unnamed)";
  const enabled = row.enabled === false ? "disabled" : "enabled";
  const idx = row.index !== undefined ? ` #${String(row.index)}` : "";
  lines.push(`— ${name}${idx} (${enabled})`);
  const action =
    row.action && typeof row.action === "object" && !Array.isArray(row.action)
      ? /** @type {Record<string, unknown>} */ (row.action)
      : null;
  if (action && typeof action.type === "string") lines.push(`  Action: ${action.type}`);
  lines.push(
    `  ${formatFirewallEndpoint(row.source, zoneMap)} → ${formatFirewallEndpoint(row.destination, zoneMap)}`,
  );
  const scope =
    row.ipProtocolScope && typeof row.ipProtocolScope === "object" && !Array.isArray(row.ipProtocolScope)
      ? /** @type {Record<string, unknown>} */ (row.ipProtocolScope)
      : null;
  if (scope && scope.ipVersion !== undefined) lines.push(`  IP scope: ${String(scope.ipVersion)}`);
  if (row.loggingEnabled === true) lines.push("  Logging: on");
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} row
 */
function formatPortForwardBlock(row) {
  const lines = [];
  const name = typeof row.name === "string" ? row.name : "(unnamed)";
  const enabled = row.enabled === false ? "disabled" : "enabled";
  lines.push(`— ${name} (${enabled})`);
  const proto = typeof row.proto === "string" ? row.proto : "";
  const dst = row.dst_port !== undefined ? String(row.dst_port) : "";
  const fwd = typeof row.fwd === "string" ? row.fwd : "";
  const fwdPort = row.fwd_port !== undefined ? String(row.fwd_port) : "";
  if (proto || dst) {
    const to = fwd ? ` → ${fwd}${fwdPort ? `:${fwdPort}` : ""}` : "";
    lines.push(`  ${proto || "tcp/udp"} WAN:${dst || "?"}${to}`);
  }
  if (typeof row.pfwd_interface === "string" && row.pfwd_interface) {
    lines.push(`  Interface: ${row.pfwd_interface}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const t0 = Date.now();
  const rejectUnauthorized = hdcTlsRejectUnauthorized(env, SPEC_TLS_INSECURE);
  const tlsInsecureVia = hdcTlsInsecureSourceEnv(env, SPEC_TLS_INSECURE);

  logUser(`query starting (cwd: ${process.cwd().replace(/\\/g, "/")})`);
  logUser(`repo root: ${repoRoot.replace(/\\/g, "/")}`);
  logUser(
    rejectUnauthorized
      ? `TLS certificate verification is ON (set ${SPEC_TLS_INSECURE}=1 or ${HDC_TLS_INSECURE_ENV}=1 if the controller uses a self-signed cert).`
      : `TLS certificate verification is OFF (${tlsInsecureVia}=1).`,
  );

  const vault = createVaultAccess(
    vaultDepsFromCli({
      env,
      log: (...a) => errout.write(`${a.join(" ")}\n`),
      error: (...a) => errout.write(`${a.join(" ")}\n`),
      warn: (...a) => errout.write(`${a.join(" ")}\n`),
      defaultVaultPath,
      existsSync,
      readLineQuestion: async (q, opts) => {
        if (opts?.mask) {
          return readLineMasked(q, errout, input);
        }
        const rl = createInterface({ input, output: errout });
        try {
          return await rl.question(q);
        } finally {
          rl.close();
        }
      },
    }),
  );

  logUser("Resolving controller base URL (env → automated inventory → manual inventory → prompt)…");

  /** @type {string | null} */
  let base = null;
  /** @type {string} */
  let baseProvenance = "";

  if (typeof env.HDC_UNIFI_CONTROLLER_URL === "string" && env.HDC_UNIFI_CONTROLLER_URL.trim()) {
    base = baseUrlFromString(env.HDC_UNIFI_CONTROLLER_URL);
    baseProvenance = "HDC_UNIFI_CONTROLLER_URL";
  } else {
    const stored = readStoredControllerBase(repoRoot);
    if (stored) {
      base = stored.url;
      baseProvenance = stored.provenance;
    } else {
      const manual = discoverControllerFromManualInventory(repoRoot);
      if (manual) {
        base = manual.url;
        baseProvenance = manual.provenance;
      }
    }
  }

  if (!base) {
    logUser("No controller URL from env or inventory; you will be prompted.");
    const rl = createInterface({ input, output: errout });
    try {
      const ans = await rl.question(
        "[unifi-network] Enter UniFi controller base URL (https://gateway-ip or hostname): ",
      );
      if (!ans || !ans.trim()) {
        errout.write("Aborted: controller URL is required.\n");
        process.exitCode = 1;
        return;
      }
      base = baseUrlFromString(ans);
      baseProvenance = "interactive prompt";
    } finally {
      rl.close();
    }
  }

  logUser(`Controller base URL: ${base}`);
  logUser(`Controller URL source: ${baseProvenance}`);

  logUser(`Checking vault for API key (secret name ${VAULT_KEY}; passphrase may be prompted)…`);
  const apiKey = await vault.getSecret(VAULT_KEY, {
    promptLabel: "UniFi Network Integration API key (Settings → Control plane → Integrations)",
    verify: async (key) => {
      try {
        logUser("Verifying API key with GET /proxy/network/integration/v1/info …");
        const info = await integrationInfo(base, key, rejectUnauthorized);
        const ver =
          info && typeof info === "object" && !Array.isArray(info) && typeof info.applicationVersion === "string"
            ? info.applicationVersion
            : "";
        logUser(ver ? `Controller integration API OK (applicationVersion ${ver}).` : "Controller integration API OK.");
        return true;
      } catch (e) {
        errout.write(
          `[unifi-network] API key verification failed (${/** @type {Error} */ (e).message}). Check URL, TLS (set ${SPEC_TLS_INSECURE}=1 or ${HDC_TLS_INSECURE_ENV}=1 for self-signed), and key permissions.\n`,
        );
        return false;
      }
    },
  });
  logUser("API key loaded and verified (value not logged).");

  let siteId = typeof env.HDC_UNIFI_SITE_ID === "string" && env.HDC_UNIFI_SITE_ID.trim() ? env.HDC_UNIFI_SITE_ID.trim() : "";
  if (!siteId) {
    logUser("Listing sites: GET /proxy/network/integration/v1/sites …");
    const sitesBody = await integrationListSites(base, apiKey, rejectUnauthorized);
    const sites =
      sitesBody && typeof sitesBody === "object" && !Array.isArray(sitesBody) && Array.isArray(sitesBody.data)
        ? sitesBody.data
        : [];
    logUser(`Sites returned: ${sites.length} (using first site if id present).`);
    const first = sites[0];
    if (first && typeof first === "object" && !Array.isArray(first) && typeof first.id === "string") {
      siteId = first.id;
    }
    if (!siteId) {
      errout.write("Could not resolve a site id from GET /integration/v1/sites. Set HDC_UNIFI_SITE_ID.\n");
      process.exitCode = 1;
      return;
    }
    const nm = first && typeof first === "object" && !Array.isArray(first) && typeof first.name === "string" ? first.name : "";
    errout.write(`[unifi-network] Resolved UniFi site id ${JSON.stringify(siteId)}${nm ? ` (${nm})` : ""} — set HDC_UNIFI_SITE_ID to pick another.\n`);
  } else {
    logUser(`Using UniFi site id from HDC_UNIFI_SITE_ID (${JSON.stringify(siteId)}).`);
  }

  /** @type {Record<string, unknown>[]} */
  let rows = [];
  /** @type {"classic" | "integration"} */
  let dataSource = "classic";

  logUser(`Fetching networks via classic API: GET …/api/s/${siteId}/rest/networkconf …`);
  try {
    const classic = await classicNetworkconf(base, apiKey, siteId, rejectUnauthorized);
    rows = classicDataArray(classic);
    logUser(`Classic networkconf parsed: ${rows.length} network row(s) (meta.rc ok).`);
  } catch (e) {
    errout.write(`[unifi-network] Classic networkconf failed for site ${siteId} (${/** @type {Error} */ (e).message}).\n`);
  }

  if (!rows.length && siteId !== "default") {
    logUser('Retrying classic networkconf with site key "default"…');
    try {
      const classicDef = await classicNetworkconf(base, apiKey, "default", rejectUnauthorized);
      rows = classicDataArray(classicDef);
      if (rows.length) {
        siteId = "default";
        logUser(`Classic "default" site succeeded (${rows.length} networks); site_id set to "default".`);
      } else {
        logUser('Classic "default" site returned no rows.');
      }
    } catch (e) {
      errout.write(`[unifi-network] Classic retry with site "default" failed (${/** @type {Error} */ (e).message}).\n`);
    }
  }

  const collectedAt = new Date().toISOString();
  /** @type {Record<string, unknown>[]} */
  let networks = [];

  if (rows.length) {
    networks = rows.map((r) => inventoryNetworkEntry(r, collectedAt));
  } else {
    dataSource = "integration";
    logUser("Classic API produced no networks; falling back to Integration API (VLAN/name/enabled; subnets/DNS need classic).");
    logUser(`Listing networks: GET …/integration/v1/sites/${siteId}/networks (paginated) …`);
    const overviews = await integrationListAllNetworkOverviews(base, apiKey, siteId, rejectUnauthorized);
    logUser(`Integration API listed ${overviews.length} network(s).`);
    if (!overviews.length) {
      errout.write("[unifi-network] No networks from Integration API either.\n");
      process.exitCode = 1;
      return;
    }
    logUser(`Fetching per-network details (${overviews.length}) …`);
    let i = 0;
    for (const ov of overviews) {
      i += 1;
      if (i === 1 || i === overviews.length || i % 10 === 0) {
        logUser(`  network detail progress: ${i}/${overviews.length}`);
      }
      const id = typeof ov.id === "string" ? ov.id : "";
      let detail = /** @type {Record<string, unknown>} */ ({});
      if (id) {
        try {
          const d = await integrationNetworkDetail(base, apiKey, siteId, id, rejectUnauthorized);
          if (d && typeof d === "object" && !Array.isArray(d)) detail = /** @type {Record<string, unknown>} */ (d);
        } catch {
          /* overview only */
        }
      }
      networks.push(inventoryIntegrationNetworkEntry(ov, detail, collectedAt));
      const merged = { ...ov, ...detail };
      rows.push(merged);
    }
    logUser("Integration API detail pass complete.");
  }

  /** @type {Record<string, unknown>[]} */
  let deviceRows = [];
  /** @type {Record<string, unknown>[]} */
  let clientRows = [];
  /** @type {Record<string, unknown>[]} */
  let pendingDeviceRows = [];

  logUser(`Listing adopted equipment: GET …/integration/v1/sites/${siteId}/devices (paginated) …`);
  try {
    deviceRows = await integrationListAllDevices(base, apiKey, siteId, rejectUnauthorized);
    logUser(`Adopted devices: ${deviceRows.length}.`);
  } catch (e) {
    errout.write(`[unifi-network] Device list failed (${/** @type {Error} */ (e).message}).\n`);
  }

  logUser(
    `Listing connected clients: integration GET …/sites/${siteId}/clients and classic POST …/stat/sta …`,
  );
  try {
    clientRows = await listConnectedClients(base, apiKey, siteId, rejectUnauthorized);
    logUser(`Connected clients (unique by MAC): ${clientRows.length}.`);
  } catch (e) {
    errout.write(`[unifi-network] Client list failed (${/** @type {Error} */ (e).message}).\n`);
  }

  logUser("Listing devices pending adoption: GET …/integration/v1/pending-devices (paginated) …");
  try {
    pendingDeviceRows = await integrationListPendingDevices(base, apiKey, rejectUnauthorized);
    logUser(`Pending adoption: ${pendingDeviceRows.length} device(s).`);
  } catch (e) {
    errout.write(`[unifi-network] Pending-devices list failed (${/** @type {Error} */ (e).message}).\n`);
  }

  const devices = deviceRows.map((r) => inventoryDeviceEntry(r, collectedAt));
  const pending_devices = pendingDeviceRows.map((r) => inventoryPendingDeviceEntry(r, collectedAt));

  /** @type {Record<string, unknown>[]} */
  let firewallZoneRows = [];
  /** @type {Record<string, unknown>[]} */
  let firewallPolicyRows = [];
  /** @type {Record<string, unknown>[]} */
  let portForwardRows = [];

  logUser(`Listing firewall zones: GET …/integration/v1/sites/${siteId}/firewall/zones …`);
  try {
    firewallZoneRows = await integrationListFirewallZones(base, apiKey, siteId, rejectUnauthorized);
    logUser(`Firewall zones: ${firewallZoneRows.length}.`);
  } catch (e) {
    errout.write(`[unifi-network] Firewall zone list failed (${/** @type {Error} */ (e).message}).\n`);
  }

  logUser(`Listing firewall policies: GET …/integration/v1/sites/${siteId}/firewall/policies …`);
  try {
    firewallPolicyRows = await integrationListFirewallPolicies(base, apiKey, siteId, rejectUnauthorized);
    logUser(`Firewall policies: ${firewallPolicyRows.length}.`);
  } catch (e) {
    errout.write(`[unifi-network] Firewall policy list failed (${/** @type {Error} */ (e).message}).\n`);
  }

  logUser(`Listing port forwards (classic API): GET …/api/s/${siteId}/rest/portforward …`);
  try {
    const pf = await classicPortForwards(base, apiKey, siteId, rejectUnauthorized);
    portForwardRows = pf.rows;
    if (pf.siteKey !== siteId) {
      logUser(`Port forwards returned via classic site key "${pf.siteKey}" (${portForwardRows.length}).`);
    } else {
      logUser(`Port forwards: ${portForwardRows.length}.`);
    }
  } catch (e) {
    errout.write(`[unifi-network] Port forward list failed (${/** @type {Error} */ (e).message}).\n`);
  }

  const firewall_zones = firewallZoneRows.map((r) => inventoryFirewallZoneEntry(r, collectedAt));
  const firewall_policies = firewallPolicyRows.map((r) => inventoryFirewallPolicyEntry(r, collectedAt));
  const port_forwards = portForwardRows.map((r) => inventoryPortForwardEntry(r, collectedAt));
  const zoneMap = firewallZoneNameMap(firewallZoneRows);

  logUser("Writing automated inventory (one JSON file per item under inventory/automated/<kind>/) …");
  migrateLegacyVendorPrefixedSidecars(repoRoot);
  migrateAutomatedSidecarsToNameSlugs(repoRoot);
  pruneAutomatedSidecarsWithIdPrefix(repoRoot, "unifi-device", ["systems"]);
  pruneAutomatedSidecarsWithIdPrefix(repoRoot, "unifi-pending", ["systems"]);
  pruneAutomatedSidecarsWithIdPrefix(repoRoot, "unifi-client", ["systems"]);
  const legacyAggregate = join(repoRoot, "inventory", "automated", "network.json");
  if (existsSync(legacyAggregate)) {
    unlinkSync(legacyAggregate);
    logUser(`Removed legacy aggregate ${relFromRoot(repoRoot, legacyAggregate)}.`);
  }

  /** @type {string[]} */
  const writtenPaths = [];
  /** @type {string[]} */
  const sharedInventoryIds = [];
  /** @type {Set<string>} */
  const usedNetworkIds = new Set();
  /** @type {Set<string>} */
  const usedPolicyIds = new Set();
  /** @type {Set<string>} */
  const usedClientSystemIds = new Set();
  /** @type {string[]} */
  const clientSystemIds = [];

  for (const n of networks) {
    const rec = buildUnifiNetworkSidecar(n, usedNetworkIds);
    sharedInventoryIds.push(rec.id);
    writtenPaths.push(mergeAutomatedSidecarFromTarget(repoRoot, rec, target));
  }
  for (const d of devices) {
    const rec = buildUnifiSystemSidecar(d, collectedAt, "device");
    writtenPaths.push(writeAutomatedSidecar(repoRoot, rec));
  }
  for (const row of clientRows) {
    const rec = buildClientSystemSidecar(row, collectedAt, usedClientSystemIds);
    clientSystemIds.push(rec.id);
    writtenPaths.push(mergeAutomatedSidecarFromTarget(repoRoot, rec, target));
  }
  for (const p of pending_devices) {
    const rec = buildUnifiSystemSidecar(p, collectedAt, "pending");
    writtenPaths.push(writeAutomatedSidecar(repoRoot, rec));
  }
  for (const fp of firewall_policies) {
    const rec = buildUnifiPolicySidecar(fp, "firewall_policy", usedPolicyIds);
    sharedInventoryIds.push(rec.id);
    writtenPaths.push(mergeAutomatedSidecarFromTarget(repoRoot, rec, target));
  }
  for (const pf of port_forwards) {
    const rec = buildUnifiPolicySidecar(pf, "port_forward", usedPolicyIds);
    sharedInventoryIds.push(rec.id);
    writtenPaths.push(mergeAutomatedSidecarFromTarget(repoRoot, rec, target));
  }

  pruneAutomatedSidecarSourceForTarget(repoRoot, ["networks", "policies"], target, sharedInventoryIds);
  pruneAutomatedSidecarSourceForTarget(repoRoot, ["systems"], target, clientSystemIds);
  logUser(
    `Wrote ${writtenPaths.length} file(s): ${networks.length} network(s), ${devices.length} device(s), ${clientSystemIds.length} client system(s), ${pending_devices.length} pending, ${firewall_policies.length} firewall policy(ies), ${port_forwards.length} port forward(s) (${firewall_zones.length} zone(s) in plugin metadata only).`,
  );

  errout.write(`\n[unifi-network] — Network summary (${dataSource}) —\n`);
  errout.write(`Controller ${base} · site ${siteId} · ${networks.length} network(s)\n\n`);
  for (const r of rows) {
    errout.write(dataSource === "classic" ? formatNetworkBlock(r) : formatIntegrationNetworkBlock(r));
  }

  if (deviceRows.length) {
    const online = deviceRows.filter((d) => d.state === "ONLINE").length;
    errout.write(`\n[unifi-network] — Adopted equipment (${deviceRows.length}, ${online} online) —\n\n`);
    for (const d of deviceRows) errout.write(formatDeviceBlock(d));
  }

  if (clientRows.length) {
    errout.write(`\n[unifi-network] — Connected clients (${clientRows.length}) —\n\n`);
    for (const c of clientRows) errout.write(formatClientBlock(c));
  }

  if (pendingDeviceRows.length) {
    errout.write(`\n[unifi-network] — Pending adoption (${pendingDeviceRows.length}) —\n\n`);
    for (const p of pendingDeviceRows) errout.write(formatPendingDeviceBlock(p));
  }

  if (firewallPolicyRows.length) {
    const enabled = firewallPolicyRows.filter((p) => p.enabled !== false).length;
    errout.write(`\n[unifi-network] — Firewall policies (${firewallPolicyRows.length}, ${enabled} enabled) —\n\n`);
    for (const p of firewallPolicyRows) errout.write(formatFirewallPolicyBlock(p, zoneMap));
  }

  if (portForwardRows.length) {
    const enabledPf = portForwardRows.filter((p) => p.enabled !== false).length;
    errout.write(`\n[unifi-network] — Port forwarding (${portForwardRows.length}, ${enabledPf} enabled) —\n\n`);
    for (const p of portForwardRows) errout.write(formatPortForwardBlock(p));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  logUser(`Finished in ${elapsed}s. JSON summary on stdout for hdc.`);

  const payload = {
    target,
    verb: "query",
    ok: true,
    collected_at: collectedAt,
    controller_base_url: base,
    site_id: siteId,
    data_source: dataSource,
    network_count: networks.length,
    device_count: devices.length,
    client_count: clientSystemIds.length,
    pending_device_count: pending_devices.length,
    firewall_zone_count: firewall_zones.length,
    firewall_policy_count: firewall_policies.length,
    port_forward_count: port_forwards.length,
    inventory_files_written: writtenPaths.length,
    message:
      "UniFi snapshot written under inventory/automated/{networks,systems,policies}/ (connected clients as sys-<slug> systems); plugin metadata in inventory/manual/targets/unifi-network.json.",
    systems: [],
  };
  mergeAutomatedSystemsFromPlugin(repoRoot, target, "query", payload);
  output.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((e) => {
  errout.write(`[unifi-network] Fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.exitCode = 1;
});
