import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, stderr as errout, env } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
import https from "node:https";
import http from "node:http";

import { findInventorySidecars } from "../../../tools/hdc/inventory.mjs";
import { createVaultAccess, vaultDepsFromCli } from "../../../tools/hdc/lib/vault-access.mjs";
import { readLineMasked } from "../../../tools/hdc/lib/readline-masked.mjs";
import { defaultVaultPath } from "../../../tools/hdc/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const repoRoot = join(here, "..", "..", "..");

const VAULT_KEY = "HDC_UNIFI_NETWORK_API_KEY";

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
  const p = join(root, "inventory", "automated", "network.json");
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    const u =
      (j.unifi && typeof j.unifi.controller_base_url === "string" && j.unifi.controller_base_url) ||
      (typeof j.controller_base_url === "string" && j.controller_base_url);
    if (u && u.trim()) {
      return {
        url: baseUrlFromString(u),
        provenance: `${relFromRoot(root, p)} (unifi.controller_base_url)`,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
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
 * @param {string} base
 * @param {string} apiKey
 * @param {string} siteId
 * @param {boolean} rejectUnauthorized
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function integrationListAllNetworkOverviews(base, apiKey, siteId, rejectUnauthorized) {
  /** @type {Record<string, unknown>[]} */
  const all = [];
  let offset = 0;
  const limit = 200;
  for (;;) {
    const url = `${base}/proxy/network/integration/v1/sites/${encodeURIComponent(siteId)}/networks?offset=${offset}&limit=${limit}`;
    const body = await requestJson({
      url,
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
      rejectUnauthorized,
    });
    const chunk =
      body && typeof body === "object" && !Array.isArray(body) && Array.isArray(body.data)
        ? body.data.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map((x) => /** @type {Record<string, unknown>} */ (x))
        : [];
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

async function main() {
  const t0 = Date.now();
  const rejectUnauthorized = env.HDC_UNIFI_TLS_INSECURE !== "1";

  logUser(`query starting (cwd: ${process.cwd().replace(/\\/g, "/")})`);
  logUser(`repo root: ${repoRoot.replace(/\\/g, "/")}`);
  logUser(
    rejectUnauthorized
      ? "TLS certificate verification is ON (set HDC_UNIFI_TLS_INSECURE=1 if the controller uses a self-signed cert)."
      : "TLS certificate verification is OFF (HDC_UNIFI_TLS_INSECURE=1).",
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
          `[unifi-network] API key verification failed (${/** @type {Error} */ (e).message}). Check URL, TLS (set HDC_UNIFI_TLS_INSECURE=1 for self-signed), and key permissions.\n`,
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

  const automatedPath = join(repoRoot, "inventory", "automated", "network.json");
  mkdirSync(dirname(automatedPath), { recursive: true });
  const doc = {
    schema_version: 1,
    last_updated: collectedAt,
    unifi: {
      controller_base_url: base,
      site_id: siteId,
      collected_at: collectedAt,
      automation_target: target,
      data_source: dataSource,
      networks,
    },
  };
  writeFileSync(automatedPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  const relOut = relFromRoot(repoRoot, automatedPath);
  logUser(`Wrote automated inventory → ${relOut} (${networks.length} network(s), source ${dataSource}).`);

  errout.write(`\n[unifi-network] — Network summary (${dataSource}) —\n`);
  errout.write(`Controller ${base} · site ${siteId} · ${networks.length} network(s)\n\n`);
  for (const r of rows) {
    errout.write(dataSource === "classic" ? formatNetworkBlock(r) : formatIntegrationNetworkBlock(r));
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
    message: "Structured networks are in inventory/automated/network.json under unifi.networks (sanitized; no Wi‑Fi PSKs).",
    systems: [],
  };
  output.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((e) => {
  errout.write(`[unifi-network] Fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.exitCode = 1;
});
