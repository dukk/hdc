import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inventoryManualDir } from "../../tools/hdc/paths.mjs";
import {
  manualSystemInventoryFileName,
  slugifyInventoryRole,
  systemIdForClass,
} from "../../tools/hdc/lib/inventory-naming.mjs";

/**
 * Canonical deploy target → inventory system id (see `.cursor/rules/hdc-inventory-naming.mdc`).
 * @type {Record<string, { workloadClass: "physical" | "vm" | "ct"; role: string; instance?: string }>}
 */
export const DEPLOY_TARGET_WORKLOAD = {
  bind: { workloadClass: "vm", role: "bind", instance: "a" },
  "pi-hole": { workloadClass: "vm", role: "pi-hole", instance: "a" },
  minecraft: { workloadClass: "vm", role: "minecraft", instance: "a" },
  jenkins: { workloadClass: "vm", role: "jenkins", instance: "a" },
  homeassistant: { workloadClass: "vm", role: "homeassistant", instance: "a" },
  audiobookshelf: { workloadClass: "vm", role: "audiobookshelf", instance: "a" },
};

/** Physical Proxmox cluster nodes (Nagios NRPE). */
export const NAGIOS_CLUSTER_NODE_IDS = ["pve-a", "pve-b", "pve-c"];

/** Sidecar holding `nagios.central` for the monitoring host. */
export const NAGIOS_CENTRAL_SYSTEM_ID = "pve-a";

/**
 * @param {string} targetId automation manifest id
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
 * @param {string} root repo root
 * @param {string} systemId
 */
export function manualSystemInventoryPath(root, systemId) {
  return join(inventoryManualDir(root), "systems", manualSystemInventoryFileName(systemId));
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
 * @param {string} root
 * @param {string} targetId
 */
export function deployTargetInventory(root, targetId) {
  const systemId = deployTargetSystemId(targetId);
  const manualPath = manualSystemInventoryPath(root, systemId);
  const sidecar = existsSync(manualPath) ? readJsonObject(manualPath) : null;
  const spec = DEPLOY_TARGET_WORKLOAD[targetId];
  const legacyId = spec ? legacyAutomatedClientSystemId(spec.role, spec.instance ?? "a") : null;
  const legacyPath = legacyId
    ? join(root, "inventory", "automated", "systems", manualSystemInventoryFileName(legacyId))
    : null;
  return {
    targetId,
    systemId,
    manualPath,
    sidecar,
    ready: sidecar !== null,
    legacyAutomatedId: legacyId,
    legacyAutomatedPath: legacyPath && existsSync(legacyPath) ? legacyPath : null,
  };
}

/**
 * @param {string} targetId
 * @param {string} verb
 * @param {ReturnType<typeof deployTargetInventory>} inv
 */
export function logDeployInventoryStatus(targetId, verb, inv) {
  const rel = inv.manualPath.replace(/\\/g, "/");
  if (inv.ready) {
    process.stderr.write(`[hdc] ${targetId} ${verb}: inventory system ${inv.systemId} (${rel})\n`);
    return;
  }
  process.stderr.write(
    `[hdc] ${targetId} ${verb}: create ${rel} (canonical id per hdc-inventory-naming)\n`,
  );
  if (inv.legacyAutomatedPath) {
    process.stderr.write(
      `[hdc] ${targetId} ${verb}: hint — UniFi client ${inv.legacyAutomatedId} at ${inv.legacyAutomatedPath.replace(/\\/g, "/")}\n`,
    );
  }
}
