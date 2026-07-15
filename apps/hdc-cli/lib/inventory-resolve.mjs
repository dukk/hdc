import { readFileSync } from "node:fs";

import {
  automatedSystemRel,
  LEGACY_MANUAL_SYSTEMS,
  manualSidecarRel,
} from "./inventory-paths.mjs";
import { resolveRepoFile } from "./private-repo.mjs";

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
 * Load manual + automated system sidecar by id.
 * @param {string} publicRoot
 * @param {string} systemId
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, unknown> | null}
 */
export function resolveSystemById(publicRoot, systemId, env = process.env) {
  const manual =
    readJsonIfExists(publicRoot, manualSidecarRel("systems", systemId), env) ??
    readJsonIfExists(publicRoot, `${LEGACY_MANUAL_SYSTEMS}/${systemId}.json`, env);
  const automated = readJsonIfExists(publicRoot, automatedSystemRel(systemId), env);
  if (!manual && !automated) return null;
  if (!manual) return automated;
  if (!automated) return manual;
  return mergeSystemRecords(manual, automated);
}

/**
 * @param {string} publicRoot
 * @param {string} serviceId
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveServiceById(publicRoot, serviceId, env = process.env) {
  return (
    readJsonIfExists(publicRoot, manualSidecarRel("services", serviceId), env) ??
    readJsonIfExists(publicRoot, `inventory/manual/services/${serviceId}.json`, env)
  );
}
