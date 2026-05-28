import { join } from "node:path";

import { readResolvedPackageConfigJson } from "../../tools/hdc/lib/json-config-preprocess.mjs";
import {
  slugifyInventoryRole,
  systemIdForClass,
} from "../../tools/hdc/lib/inventory-naming.mjs";
import { resolveRepoFile } from "../../tools/hdc/lib/private-repo.mjs";

/**
 * Canonical deploy target → logical system id (see `.cursor/rules/hdc-inventory-naming.mdc`).
 * @type {Record<string, { workloadClass: "physical" | "vm" | "lxc"; role: string; instance?: string }>}
 */
export const DEPLOY_TARGET_WORKLOAD = {
  bind: { workloadClass: "vm", role: "bind", instance: "a" },
  "pi-hole": { workloadClass: "lxc", role: "pi-hole", instance: "a" },
  minecraft: { workloadClass: "vm", role: "minecraft", instance: "a" },
  jenkins: { workloadClass: "vm", role: "jenkins", instance: "a" },
  homeassistant: { workloadClass: "vm", role: "homeassistant", instance: "a" },
  audiobookshelf: { workloadClass: "vm", role: "audiobookshelf", instance: "a" },
  ollama: { workloadClass: "lxc", role: "ollama", instance: "a" },
  lms: { workloadClass: "vm", role: "lms", instance: "a" },
  "postfix-relay": { workloadClass: "lxc", role: "postfix-relay", instance: "a" },
  vaultwarden: { workloadClass: "lxc", role: "vaultwarden", instance: "a" },
  scanopy: { workloadClass: "lxc", role: "scanopy", instance: "a" },
  postiz: { workloadClass: "lxc", role: "postiz", instance: "a" },
  "nginx-waf": { workloadClass: "vm", role: "nginx-waf", instance: "a" },
  nginx: { workloadClass: "vm", role: "nginx", instance: "a" },
};

/** Defaults for Nagios NRPE layout (override in `packages/services/nagios/config.json`). */
export const NAGIOS_CLUSTER_NODE_IDS = ["hypervisor-a", "hypervisor-b", "hypervisor-c"];

export const NAGIOS_CENTRAL_SYSTEM_ID = "hypervisor-a";

/**
 * @param {string} targetId package manifest id
 * @returns {string}
 */
export function deployTargetSystemId(targetId) {
  const spec = DEPLOY_TARGET_WORKLOAD[targetId];
  if (!spec) {
    throw new Error(`deployTargetSystemId: unknown deploy target ${JSON.stringify(targetId)}`);
  }
  return systemIdForClass(spec.workloadClass, spec.role, spec.instance ?? "a");
}

/**
 * @param {string} root
 * @param {string} serviceId
 */
export function servicePackageConfigPath(root, serviceId) {
  return join(root, "packages", "services", serviceId, "config.json");
}

/**
 * @param {import("../../tools/hdc/lib/private-repo.mjs").ResolvedRepoFile} resolved
 * @param {string} publicRoot
 */
function readConfigObject(resolved, publicRoot) {
  if (!resolved.found) {
    return null;
  }
  try {
    const v = readResolvedPackageConfigJson(resolved, { publicRoot });
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return /** @type {Record<string, unknown>} */ (v);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Legacy UniFi automated id (`sys-<role>-<letter>`) for the same role letter.
 * @param {string} role
 * @param {string} [instance]
 */
export function legacyAutomatedClientSystemId(role, instance = "a") {
  return `sys-${slugifyInventoryRole(role)}-${String(instance).trim().toLowerCase() || "a"}`;
}

/**
 * @param {string} root
 * @param {string} targetId
 * @param {{ systemIdOverride?: string }} [opts]
 */
export function deployTargetInventory(root, targetId, opts = {}) {
  const rel = `packages/services/${targetId}/config.json`;
  const resolved = resolveRepoFile(root, rel);
  const configPath = resolved.found ? resolved.path : resolved.publicPath;
  const cfg = resolved.found ? readConfigObject(resolved, root) : null;
  const override =
    cfg && typeof cfg.deploy === "object" && cfg.deploy !== null && !Array.isArray(cfg.deploy)
      ? /** @type {Record<string, unknown>} */ (cfg.deploy)
      : null;
  const explicitOverride =
    typeof opts.systemIdOverride === "string" && opts.systemIdOverride.trim()
      ? opts.systemIdOverride.trim()
      : null;
  const sid =
    explicitOverride ??
    (override && typeof override.system_id === "string" && override.system_id.trim()
      ? override.system_id.trim()
      : deployTargetSystemId(targetId));
  return {
    targetId,
    systemId: sid,
    configPath,
    config: cfg,
    deploy: override,
    ready: resolved.found,
  };
}

/**
 * @param {string} targetId
 * @param {string} verb
 * @param {ReturnType<typeof deployTargetInventory>} inv
 */
export function logDeployInventoryStatus(targetId, verb, inv) {
  const rel = inv.configPath.replace(/\\/g, "/");
  if (inv.ready) {
    process.stderr.write(`[hdc] ${targetId} ${verb}: package config ${rel} (system_id ${inv.systemId})\n`);
    return;
  }
  process.stderr.write(
    `[hdc] ${targetId} ${verb}: add ${rel} (copy config.example.json; expected system_id ${inv.systemId})\n`,
  );
}
