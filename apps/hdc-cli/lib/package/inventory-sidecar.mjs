import { readFileSync } from "node:fs";

import { readResolvedRepoJson, resolveRepoFile } from "../private-repo.mjs";

/**
 * @param {string} root Public hdc repo root
 * @param {string} relPath Repo-relative path under inventory/
 * @returns {Record<string, unknown> | null}
 */
function loadManualSidecarAtRel(root, relPath) {
  const resolved = resolveRepoFile(root, relPath);
  if (!resolved.found) return null;
  try {
    const data = readResolvedRepoJson(resolved);
    return data && typeof data === "object" && !Array.isArray(data)
      ? /** @type {Record<string, unknown>} */ (data)
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} root
 * @param {string} systemId
 * @returns {Record<string, unknown> | null}
 */
export function loadManualSystemSidecar(root, systemId) {
  return loadManualSidecarAtRel(root, `inventory/manual/systems/${systemId}.json`);
}

/**
 * @param {string} root
 * @param {string} serviceId
 * @returns {Record<string, unknown> | null}
 */
export function loadManualServiceSidecar(root, serviceId) {
  return loadManualSidecarAtRel(root, `inventory/manual/services/${serviceId}.json`);
}

/**
 * Resolve repo-relative or absolute sidecar path for bootstrap-hdc --sidecar.
 * @param {string} publicRoot
 * @param {string} pathOrRel
 */
export function resolveManualSidecarPath(publicRoot, pathOrRel) {
  const raw = typeof pathOrRel === "string" ? pathOrRel.trim() : "";
  if (!raw) return null;
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) {
    return raw;
  }
  const resolved = resolveRepoFile(publicRoot, raw.replace(/\\/g, "/"));
  return resolved.found ? resolved.path : null;
}

/**
 * @param {string} path Absolute path to sidecar JSON
 * @returns {Record<string, unknown> | null}
 */
export function loadSidecarJsonFile(path) {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data)
      ? /** @type {Record<string, unknown>} */ (data)
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} system
 * @returns {string | null}
 */
export function primaryIpFromSystem(system) {
  if (!system || typeof system !== "object" || Array.isArray(system)) return null;
  const access = /** @type {Record<string, unknown>} */ (system).access;
  if (!access || typeof access !== "object" || Array.isArray(access)) return null;
  const nodes = /** @type {unknown[]} */ (access).nodes;
  if (!Array.isArray(nodes) || !nodes.length) return null;
  const first = nodes[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const ip = /** @type {Record<string, unknown>} */ (first).ip;
  return typeof ip === "string" && ip.trim() ? ip.trim() : null;
}

/**
 * @param {unknown} system
 * @returns {{ name?: string; ip?: string; web_ui?: string; ssh?: string }[]}
 */
export function accessNodesFromSystem(system) {
  if (!system || typeof system !== "object" || Array.isArray(system)) return [];
  const access = /** @type {Record<string, unknown>} */ (system).access;
  if (!access || typeof access !== "object" || Array.isArray(access)) return [];
  const nodes = access.nodes;
  if (!Array.isArray(nodes)) return [];
  /** @type {{ name?: string; ip?: string; web_ui?: string; ssh?: string }[]} */
  const out = [];
  for (const n of nodes) {
    if (!n || typeof n !== "object" || Array.isArray(n)) continue;
    const row = /** @type {Record<string, unknown>} */ (n);
    /** @type {{ name?: string; ip?: string; web_ui?: string; ssh?: string }} */
    const entry = {};
    if (typeof row.name === "string" && row.name.trim()) entry.name = row.name.trim();
    if (typeof row.ip === "string" && row.ip.trim()) entry.ip = row.ip.trim();
    if (typeof row.web_ui === "string" && row.web_ui.trim()) entry.web_ui = row.web_ui.trim();
    if (typeof row.ssh === "string" && row.ssh.trim()) entry.ssh = row.ssh.trim();
    out.push(entry);
  }
  return out;
}

/**
 * Service ids from a system sidecar `services` array.
 * @param {unknown} system
 * @returns {string[]}
 */
export function serviceIdsFromSystem(system) {
  if (!system || typeof system !== "object" || Array.isArray(system)) return [];
  const services = /** @type {Record<string, unknown>} */ (system).services;
  if (!Array.isArray(services)) return [];
  /** @type {string[]} */
  const ids = [];
  for (const s of services) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const id = /** @type {Record<string, unknown>} */ (s).id;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
  }
  return ids;
}
