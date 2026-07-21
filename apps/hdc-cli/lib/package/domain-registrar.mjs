/**
 * Pluggable domain registrar for apex portfolio inventory.
 *
 * Implementations live under `clumps/infrastructure/<registrar>/lib/` (e.g. Cloudflare).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { AUTOMATED_DOMAINS, automatedDomainRel } from "../inventory-paths.mjs";
import { preferredNewFilePath, writeResolvedRepoJson } from "../private-repo.mjs";

/**
 * @typedef {object} DomainRegistrarLog
 * @property {(s: string) => void} info
 * @property {(s: string) => void} [warn]
 * @property {(s: string) => void} [error]
 */

/**
 * @typedef {object} DomainRecord
 * @property {string} apex Apex FQDN (lowercase).
 * @property {boolean} in_account Present in live registrar/DNS account.
 * @property {string} [status] Zone or registration status.
 * @property {string} [zone_id] Provider zone id when applicable.
 * @property {string | null} [expires_at] ISO registration expiry.
 * @property {string} [registrar_name] Display name from RDAP / API.
 * @property {string[]} [nameservers]
 * @property {Record<string, unknown>} [extra] Backend-specific fields (stderr-safe).
 */

/**
 * @typedef {object} DomainRegistrar
 * @property {string} backendId Short id, e.g. `cloudflare`.
 * @property {(log: DomainRegistrarLog) => Promise<DomainRecord[]>} listDomains
 */

/**
 * @param {unknown} v
 * @returns {v is DomainRegistrar}
 */
export function isDomainRegistrar(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = /** @type {Record<string, unknown>} */ (v);
  return typeof o.backendId === "string" && typeof o.listDomains === "function";
}

/**
 * @param {DomainRecord} rec
 * @param {string} backendId
 * @param {string} [queryLast]
 * @returns {Record<string, unknown>}
 */
export function domainRecordToAutomatedInventory(rec, backendId, queryLast = new Date().toISOString()) {
  const apex = String(rec.apex || "")
    .trim()
    .toLowerCase();
  /** @type {Record<string, unknown>} */
  const row = {
    schema_version: 1,
    id: apex,
    kind: "domain",
    apex,
    registrar: backendId,
    in_account: Boolean(rec.in_account),
    expires_at: rec.expires_at ?? null,
    query_last: queryLast,
    automation_targets: [backendId],
    sources: {
      [backendId]: {
        collected_at: queryLast,
        zone_id: rec.zone_id ?? null,
        zone_status: rec.status ?? null,
        registrar_name: rec.registrar_name ?? null,
      },
    },
  };
  if (rec.zone_id) row.zone_id = rec.zone_id;
  if (rec.status) row.zone_status = rec.status;
  if (rec.registrar_name) row.registrar_name = rec.registrar_name;
  if (Array.isArray(rec.nameservers) && rec.nameservers.length) {
    row.nameservers = rec.nameservers;
  }
  return row;
}

/**
 * Write automated domain sidecars under operations/automated/domains/.
 * @param {string} publicRoot hdc public repo root
 * @param {DomainRecord[]} records
 * @param {{ backendId: string; log?: DomainRegistrarLog; env?: NodeJS.ProcessEnv }} opts
 * @returns {{ written: number; paths: string[] }}
 */
export function writeAutomatedDomainInventory(publicRoot, records, opts) {
  const backendId = opts.backendId;
  const log = opts.log;
  const env = opts.env ?? process.env;
  const queryLast = new Date().toISOString();
  /** @type {string[]} */
  const paths = [];

  for (const rec of records) {
    const apex = String(rec.apex || "")
      .trim()
      .toLowerCase();
    if (!apex) continue;
    const payload = domainRecordToAutomatedInventory(rec, backendId, queryLast);
    const rel = automatedDomainRel(apex);
    const absPath = preferredNewFilePath(publicRoot, rel, env);
    mkdirSync(dirname(absPath), { recursive: true });
    writeResolvedRepoJson(
      {
        found: true,
        path: absPath,
        rel,
        source: absPath.includes("hdc-private") ? "private" : "public",
        privateRoot: null,
      },
      payload,
    );
    paths.push(absPath);
    log?.info?.(`wrote automated domain ${apex} → ${rel}`);
  }

  return { written: paths.length, paths };
}

/**
 * @param {Console} con
 * @returns {DomainRegistrarLog}
 */
export function domainRegistrarLogFromConsole(con) {
  return {
    info: (s) => con.error(`[domain-registrar] ${s}`),
    warn: (s) => con.warn(`[domain-registrar] ${s}`),
    error: (s) => con.error(`[domain-registrar] ${s}`),
  };
}

export { AUTOMATED_DOMAINS };
