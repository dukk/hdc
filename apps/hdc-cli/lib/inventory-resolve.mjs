import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  MANUAL_SYSTEMS,
  SYSTEM_CLASSES,
  automatedDomainRel,
  automatedSystemRel,
  manualCategoryLegacyRels,
  manualSidecarLegacyRels,
  manualSidecarRel,
  manualSystemSidecarCandidateRels,
} from "./inventory-paths.mjs";
import { hdcPrivateRoot, resolveRepoFile } from "./private-repo.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Shallow merge: automated overlay wins on key conflicts.
 * @param {Record<string, unknown>} manual
 * @param {Record<string, unknown>} automated
 */
export function mergeSystemRecords(manual, automated) {
  return { ...manual, ...automated };
}

/**
 * Domain merge: automated wins on live keys; keep manual purpose/notes/site flags when automated omits them.
 * @param {Record<string, unknown>} manual
 * @param {Record<string, unknown>} automated
 */
export function mergeDomainRecords(manual, automated) {
  const merged = { ...manual, ...automated };
  for (const key of ["purpose", "notes", "dns", "website", "mail", "renewal_usd", "in_config"]) {
    if (merged[key] === undefined || merged[key] === null) {
      if (manual[key] !== undefined) merged[key] = manual[key];
    }
  }
  return merged;
}

/**
 * @param {string} publicRoot
 * @param {string} rel
 * @param {NodeJS.ProcessEnv} [env]
 */
function readJsonIfExists(publicRoot, rel, env) {
  const resolved = resolveRepoFile(publicRoot, rel, env);
  if (!resolved.found) return null;
  try {
    const data = JSON.parse(readFileSync(resolved.path, "utf8"));
    return isObject(data) ? /** @type {Record<string, unknown>} */ (data) : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} publicRoot
 * @param {string[]} rels
 * @param {NodeJS.ProcessEnv} [env]
 */
function readFirstJson(publicRoot, rels, env) {
  for (const rel of rels) {
    const data = readJsonIfExists(publicRoot, rel, env);
    if (data) return data;
  }
  return null;
}

/**
 * Collect *.json stems from a directory (non-recursive).
 * @param {string} dir
 * @param {Set<string>} ids
 */
function collectJsonStems(dir, ids) {
  if (!existsSync(dir)) return;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith("_")) continue;
    try {
      if (!statSync(join(dir, name)).isFile()) continue;
    } catch {
      continue;
    }
    ids.add(name.replace(/\.json$/i, ""));
  }
}

/**
 * List manual system ids from public + private inventory (class subdirs + flat legacy).
 * @param {string} publicRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function listManualSystemIds(publicRoot, env = process.env) {
  /** @type {Set<string>} */
  const ids = new Set();
  const privateRoot = hdcPrivateRoot(publicRoot, env);
  /** @type {string[]} */
  const roots = [];
  if (privateRoot) roots.push(privateRoot);
  roots.push(publicRoot);

  for (const root of roots) {
    const systemsRoot = join(root, MANUAL_SYSTEMS);
    for (const cls of SYSTEM_CLASSES) {
      collectJsonStems(join(systemsRoot, cls), ids);
    }
    // Flat legacy under systems/
    collectJsonStems(systemsRoot, ids);
    for (const legacy of manualCategoryLegacyRels("systems")) {
      collectJsonStems(join(root, legacy), ids);
    }
  }
  return [...ids].sort();
}

/**
 * Load manual + automated system sidecar by id.
 * @param {string} publicRoot
 * @param {string} systemId
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, unknown> | null}
 */
export function resolveSystemById(publicRoot, systemId, env = process.env) {
  const manual = readFirstJson(publicRoot, manualSystemSidecarCandidateRels(systemId), env);
  const automated = readJsonIfExists(publicRoot, automatedSystemRel(systemId), env);
  if (!manual && !automated) return null;
  if (!manual) return automated;
  if (!automated) return manual;
  return mergeSystemRecords(manual, automated);
}

/**
 * Resolve an existing manual system sidecar path (class dirs then legacy).
 * @param {string} publicRoot
 * @param {string} systemId
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveManualSystemSidecarFile(publicRoot, systemId, env = process.env) {
  for (const rel of manualSystemSidecarCandidateRels(systemId)) {
    const resolved = resolveRepoFile(publicRoot, rel, env);
    if (resolved.found) return resolved;
  }
  return null;
}

/**
 * @param {string} publicRoot
 * @param {string} serviceId
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveServiceById(publicRoot, serviceId, env = process.env) {
  return readFirstJson(
    publicRoot,
    [manualSidecarRel("services", serviceId), ...manualSidecarLegacyRels("services", serviceId)],
    env,
  );
}

/**
 * Load manual + automated domain sidecar by apex id.
 * @param {string} publicRoot
 * @param {string} domainId
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, unknown> | null}
 */
export function resolveDomainById(publicRoot, domainId, env = process.env) {
  const manual = readFirstJson(
    publicRoot,
    [manualSidecarRel("domains", domainId), ...manualSidecarLegacyRels("domains", domainId)],
    env,
  );
  const automated = readJsonIfExists(publicRoot, automatedDomainRel(domainId), env);
  if (!manual && !automated) return null;
  if (!manual) return automated;
  if (!automated) return manual;
  return mergeDomainRecords(manual, automated);
}
