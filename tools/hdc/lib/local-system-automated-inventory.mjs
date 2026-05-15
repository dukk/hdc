import os from "node:os";
import { findInventorySidecars, loadAutomatedSystemsDoc, mergeAutomatedSystemsFromPlugin } from "../inventory.mjs";

/** @typedef {{ hostname: string, ips: string[], platform: string, arch: string }} HostProbe */

export const LOCAL_HOST_INVENTORY_PLUGIN_ID = "hdc-local-host";

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

/**
 * @param {string | undefined} s
 * @returns {string | null}
 */
function hostFromUrl(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  try {
    const u = new URL(s.trim());
    const h = (u.hostname || "").trim().toLowerCase();
    return h || null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} node
 * @param {HostProbe} probe
 */
function accessNodeMatchesLocalHost(node, probe) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const o = /** @type {Record<string, unknown>} */ (node);
  /** @type {Set<string>} */
  const tokens = new Set();
  const hn = o.hostnames;
  if (Array.isArray(hn)) {
    for (const raw of hn) {
      if (typeof raw !== "string") continue;
      const t = raw.trim().toLowerCase();
      if (!t) continue;
      tokens.add(t);
      const first = t.split(".")[0];
      if (first) tokens.add(first);
    }
  }
  const ip = typeof o.ip === "string" ? o.ip.trim().toLowerCase() : "";
  if (ip) tokens.add(ip);
  for (const k of ["web_ui", "ssh"]) {
    const h = hostFromUrl(typeof o[k] === "string" ? o[k] : undefined);
    if (h) tokens.add(h);
  }
  /** @type {Set<string>} */
  const probeHosts = new Set();
  const ph = probe.hostname.trim().toLowerCase();
  if (ph) {
    probeHosts.add(ph);
    const first = ph.split(".")[0];
    if (first) probeHosts.add(first);
  }
  for (const a of probeHosts) {
    if (tokens.has(a)) return true;
  }
  for (const pip of probe.ips) {
    if (tokens.has(pip.trim().toLowerCase())) return true;
  }
  return false;
}

/**
 * @param {string} root
 * @param {(path: string) => string} readUtf8
 * @param {HostProbe} probe
 * @returns {{ id: string, ambiguous: boolean }}
 */
export function resolveManualSystemIdForLocalHost(root, readUtf8, probe) {
  /** @type {Map<string, string>} id -> first path (for stable ordering) */
  const idToPath = new Map();
  for (const p of findInventorySidecars(root)) {
    let data;
    try {
      data = JSON.parse(readUtf8(p));
    } catch {
      continue;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const o = /** @type {Record<string, unknown>} */ (data);
    if (o.kind !== "system") continue;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id) continue;
    const access = o.access;
    if (!access || typeof access !== "object" || access === null || Array.isArray(access)) continue;
    const nodes = /** @type {Record<string, unknown>} */ (access).nodes;
    if (!Array.isArray(nodes)) continue;
    let hit = false;
    for (const node of nodes) {
      if (accessNodeMatchesLocalHost(node, probe)) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    if (!idToPath.has(id)) idToPath.set(id, p);
  }
  const ids = [...idToPath.keys()].sort();
  if (ids.length === 0) return { id: "", ambiguous: false };
  if (ids.length === 1) return { id: ids[0], ambiguous: false };
  return { id: ids[0], ambiguous: true };
}

/**
 * @param {string} root
 * @param {string} systemId
 */
export function automatedSystemsDocMissingSystemRow(root, systemId) {
  const doc = loadAutomatedSystemsDoc(root);
  const row = doc.systems[systemId];
  if (!row || typeof row !== "object" || Array.isArray(row)) return true;
  return false;
}

/**
 * @param {string} systemId
 * @param {HostProbe} probe
 * @returns {Record<string, unknown>}
 */
export function localHostInventoryPayload(systemId, probe) {
  return {
    systems: [
      {
        id: systemId,
        hdc_local_host: {
          hostname: probe.hostname,
          ips: [...probe.ips],
          platform: probe.platform,
          arch: probe.arch,
        },
      },
    ],
  };
}

/**
 * @param {string[]} argv hdc argv after slice(2) — same array passed to runCli
 */
export function shouldSkipLocalSystemInventoryCollection(argv, env) {
  if (String(env.HDC_SKIP_LOCAL_SYSTEM_INVENTORY ?? "").trim() === "1") return true;
  const ci = String(env.CI ?? "").trim().toLowerCase();
  if (ci === "1" || ci === "true") return true;
  const cmd = argv[0];
  if (!cmd) return true;
  if (cmd === "help") return true;
  if (cmd === "docs") return true;
  /** Commands where an automated snapshot is appropriate (exclude unknown argv[0]). */
  const allowed = new Set(["list", "run", "inventory", "secrets", "users"]);
  if (!allowed.has(cmd)) return true;
  if (cmd === "inventory" && argv[1] !== "apply") return true;
  return false;
}

/**
 * If this machine matches a manual system sidecar and that id has no row in
 * inventory/automated/systems.json yet, merge a small local snapshot (via the
 * same path as plugin query merges).
 * @param {{ readFileSync: import("node:fs").readFileSync, log: Function, warn: Function, hostProbe: () => HostProbe }} deps
 * @param {string} root
 */
export function ensureLocalSystemAutomatedInventory(deps, root) {
  const p = deps.hostProbe();
  const { id, ambiguous } = resolveManualSystemIdForLocalHost(root, (path) => deps.readFileSync(path, "utf8"), p);
  if (!id) return;
  if (ambiguous) {
    deps.warn(
      `local inventory: multiple manual systems match this host; using ${JSON.stringify(id)} (set HDC_SKIP_LOCAL_SYSTEM_INVENTORY=1 to disable)`,
    );
  }
  if (!automatedSystemsDocMissingSystemRow(root, id)) return;
  const payload = localHostInventoryPayload(id, p);
  mergeAutomatedSystemsFromPlugin(root, LOCAL_HOST_INVENTORY_PLUGIN_ID, "query", payload);
  deps.log(
    `local inventory: wrote first automated snapshot for system ${JSON.stringify(id)} -> inventory/automated/systems.json`,
  );
}
