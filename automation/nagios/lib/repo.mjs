import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of `automation/`). */
export function nagiosRepoRoot() {
  return join(__dirname, "..", "..", "..");
}

/** Logical cluster id for NRPE-enabled Proxmox nodes in the primary site (matches inventory `proxmox_cluster.id`). */
export const PRIMARY_PROXMOX_CLUSTER_INVENTORY_ID = "proxmox-primary-cluster";

/**
 * Sidecar that holds `nagios.central` for the primary cluster (pve-a).
 * Other cluster nodes are separate system sidecars with the same `proxmox_cluster.id`.
 */
export function primaryClusterInventoryPath(root = nagiosRepoRoot()) {
  return join(root, "inventory", "manual", "systems", "pve-a.inventory.json");
}
