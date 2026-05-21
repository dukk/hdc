import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  slugifyInventoryRole,
  systemIdForClass,
} from "../../tools/hdc/lib/inventory-naming.mjs";

/**
 * Canonical deploy target → logical system id (see `.cursor/rules/hdc-inventory-naming.mdc`).
 * @type {Record<string, { workloadClass: "physical" | "vm" | "ct"; role: string; instance?: string }>}
 */
export const DEPLOY_TARGET_WORKLOAD = {
  bind: { workloadClass: "vm", role: "bind", instance: "a" },
  "pi-hole": { workloadClass: "vm", role: "pi-hole", instance: "a" },
  minecraft: { workloadClass: "vm", role: "minecraft", instance: "a" },
  jenkins: { workloadClass: "vm", role: "jenkins", instance: "a" },
  homeassistant: { workloadClass: "vm", role: "homeassistant", instance: "a" },
  audiobookshelf: { workloadClass: "vm", role: "audiobookshelf", instance: "a" },
  ollama: { workloadClass: "ct", role: "ollama", instance: "a" },
  "postfix-relay": { workloadClass: "ct", role: "postfix-relay", instance: "a" },
};

/** Defaults for Nagios NRPE layout (override in `packages/services/nagios/config.json`). */
export const NAGIOS_CLUSTER_NODE_IDS = ["pve-a", "pve-b", "pve-c"];

export const NAGIOS_CENTRAL_SYSTEM_ID = "pve-a";

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
 * @param {string} path
 */
function readJsonObject(path) {
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
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
 */
export function deployTargetInventory(root, targetId) {
  const systemId = deployTargetSystemId(targetId);
  const configPath = servicePackageConfigPath(root, targetId);
  const cfg = existsSync(configPath) ? readJsonObject(configPath) : null;
  const override =
    cfg && typeof cfg.deploy === "object" && cfg.deploy !== null && !Array.isArray(cfg.deploy)
      ? /** @type {Record<string, unknown>} */ (cfg.deploy)
      : null;
  const sid =
    override && typeof override.system_id === "string" && override.system_id.trim()
      ? override.system_id.trim()
      : systemId;
  return {
    targetId,
    systemId: sid,
    configPath,
    config: cfg,
    deploy: override,
    ready: cfg !== null,
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
