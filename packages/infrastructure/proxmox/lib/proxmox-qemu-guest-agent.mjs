import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  authorizeProxmoxForClusterMembers,
  PROXMOX_MAINTAIN_VERIFY_PATHS,
} from "./proxmox-deploy-auth.mjs";
import { fetchClusterVmResources } from "./proxmox-host-provisioner.mjs";

/** @typedef {import("./proxmox-host-load-report.mjs").GuestConfig} GuestConfig */
import { loadProxmoxPackageConfig } from "./proxmox-package-config.mjs";
import { loadProxmoxHostsByCluster } from "./proxmox-config.mjs";
import { pveData, pveJsonRequest } from "./pve-http.mjs";

/**
 * @typedef {"disabled" | "enabled_stopped" | "ok" | "not_responding" | "permission_denied"} QemuGuestAgentStatus
 */

/**
 * @typedef {object} QemuGuestAgentProbe
 * @property {boolean} attempted
 * @property {boolean} ok
 * @property {number} [httpStatus]
 * @property {string} [error]
 */

/**
 * @typedef {object} QemuGuestAgentRow
 * @property {number} vmid
 * @property {string} name
 * @property {string} node
 * @property {string} status
 * @property {QemuGuestAgentStatus} agentStatus
 * @property {boolean} configEnabled
 * @property {string} summary
 * @property {string} [notes]
 */

/**
 * @typedef {object} QemuGuestAgentHostReport
 * @property {string} hostId
 * @property {string} pveNode
 * @property {QemuGuestAgentRow[]} guests
 */

/**
 * @typedef {object} QemuGuestAgentClusterReport
 * @property {string} id
 * @property {QemuGuestAgentHostReport[]} hosts
 */

/**
 * @typedef {object} QemuGuestAgentReportData
 * @property {boolean} ok
 * @property {string[]} warnings
 * @property {QemuGuestAgentClusterReport[]} clusters
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function qemuAgentEnabledFromConfig(value) {
  if (value === 1 || value === true) return true;
  if (typeof value !== "string") return false;
  const s = value.trim().toLowerCase();
  if (!s) return false;
  if (s === "1") return true;
  if (s === "enabled=1" || s === "enabled=on") return true;
  if (/^enabled\s*=\s*1$/i.test(s)) return true;
  return false;
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown> | null}
 */
function configRecordFromBody(body) {
  const d = pveData(body);
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  return /** @type {Record<string, unknown>} */ (d);
}

/**
 * @param {string} message
 * @returns {number | null}
 */
export function httpStatusFromPveError(message) {
  const m = String(message ?? "").match(/Proxmox HTTP (\d{3})/);
  return m ? Number(m[1]) : null;
}

/**
 * @param {string} message
 * @returns {boolean}
 */
export function isGuestAgentPermissionError(message) {
  const code = httpStatusFromPveError(message);
  if (code === 403 || code === 401) return true;
  const lower = String(message ?? "").toLowerCase();
  return lower.includes("permission") && lower.includes("guest");
}

/**
 * @param {object} opts
 * @param {GuestConfig} opts.guest
 * @param {boolean} opts.configEnabled
 * @param {QemuGuestAgentProbe | null} opts.probe
 * @returns {{ agentStatus: QemuGuestAgentStatus; summary: string; notes?: string }}
 */
export function classifyQemuGuestAgentRow(opts) {
  const { guest, configEnabled, probe } = opts;
  const running = guest.status === "running";

  if (!configEnabled) {
    return {
      agentStatus: "disabled",
      summary: running ? "agent not enabled in VM config" : "agent disabled (VM stopped)",
    };
  }

  if (!running) {
    return {
      agentStatus: "enabled_stopped",
      summary: "agent enabled in config; VM not running (ping skipped)",
    };
  }

  if (!probe || !probe.attempted) {
    return {
      agentStatus: "not_responding",
      summary: "agent enabled; ping not attempted",
    };
  }

  if (probe.ok) {
    return { agentStatus: "ok", summary: "agent enabled and responding" };
  }

  if (isGuestAgentPermissionError(probe.error ?? "")) {
    return {
      agentStatus: "permission_denied",
      summary: "agent enabled; API permission denied for guest-agent ping",
      notes: probe.error,
    };
  }

  return {
    agentStatus: "not_responding",
    summary: "agent enabled in config but guest agent not responding",
    notes: probe.error,
  };
}

/**
 * @param {QemuGuestAgentRow} row
 * @returns {string[]}
 */
export function guestAgentWarningsForRow(row) {
  /** @type {string[]} */
  const warnings = [];
  const label = `vmid ${row.vmid} ${row.name} on ${row.node}`;

  if (row.agentStatus === "not_responding" && row.status === "running") {
    warnings.push(`${label}: QEMU guest agent enabled but not responding`);
  } else if (row.agentStatus === "permission_denied") {
    warnings.push(
      `${label}: guest agent ping denied — ensure hdc API role includes VM.GuestAgent.Audit (PVE 9) or VM.Monitor (PVE 8)`,
    );
  }

  return warnings;
}

/**
 * @param {QemuGuestAgentReportData} data
 * @returns {string[]}
 */
export function guestAgentWarningsFromReport(data) {
  /** @type {string[]} */
  const warnings = [];
  for (const cluster of data.clusters) {
    for (const host of cluster.hosts) {
      for (const row of host.guests) {
        warnings.push(...guestAgentWarningsForRow(row));
      }
    }
  }
  return warnings;
}

/**
 * @param {string} apiBase
 * @param {string} node
 * @param {number} vmid
 * @param {string} authorization
 * @param {boolean} rejectUnauthorized
 * @returns {Promise<{ enabled: boolean; config: Record<string, unknown> | null }>}
 */
export async function fetchQemuConfigAgentState(
  apiBase,
  node,
  vmid,
  authorization,
  rejectUnauthorized,
) {
  const path = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/config`;
  const body = await pveJsonRequest(
    "GET",
    apiBase,
    path,
    authorization,
    rejectUnauthorized,
    undefined,
  );
  const config = configRecordFromBody(body);
  const enabled = config ? qemuAgentEnabledFromConfig(config.agent) : false;
  return { enabled, config };
}

/**
 * @param {string} apiBase
 * @param {string} node
 * @param {number} vmid
 * @param {string} authorization
 * @param {boolean} rejectUnauthorized
 * @returns {Promise<QemuGuestAgentProbe>}
 */
export async function pingQemuGuestAgent(apiBase, node, vmid, authorization, rejectUnauthorized) {
  const path = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/agent/ping`;
  try {
    await pveJsonRequest("POST", apiBase, path, authorization, rejectUnauthorized, undefined);
    return { attempted: true, ok: true };
  } catch (e) {
    const err = /** @type {Error} */ (e);
    return {
      attempted: true,
      ok: false,
      httpStatus: httpStatusFromPveError(err.message) ?? undefined,
      error: err.message || String(e),
    };
  }
}

/**
 * @param {QemuGuestAgentRow[]} guests
 * @returns {string}
 */
export function summarizeGuestAgentCounts(guests) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const g of guests) {
    counts[g.agentStatus] = (counts[g.agentStatus] ?? 0) + 1;
  }
  const order = ["ok", "not_responding", "permission_denied", "enabled_stopped", "disabled"];
  const parts = order.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`);
  return parts.length ? parts.join(", ") : "no QEMU workload VMs";
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {(line: string) => void} [opts.warn]
 * @param {import("../../../../tools/hdc/lib/vault-access.mjs").ReturnType<import("../../../../tools/hdc/lib/vault-access.mjs").createVaultAccess>} [opts.vault]
 * @param {(q: string, o?: { mask?: boolean }) => Promise<string>} [opts.readLineQuestion]
 * @returns {Promise<QemuGuestAgentReportData>}
 */
export async function collectProxmoxQemuGuestAgentReport(opts) {
  const { packageRoot, warn = () => {}, vault, readLineQuestion } = opts;
  const loaded = loadProxmoxMaintainConfig(packageRoot, warn, "QEMU guest agent");
  if (!loaded) {
    return { ok: true };
  }
  const cfg = loaded.data;
  const configPath = loaded.path;

  log("QEMU guest agent report (config + ping for running VMs) …");

  const data = await collectProxmoxQemuGuestAgentReport({
    packageRoot,
    warn,
    vault,
    readLineQuestion,
  });

  for (const cluster of data.clusters) {
    for (const host of cluster.hosts) {
      log(
        `Host ${JSON.stringify(host.hostId)} (${JSON.stringify(cluster.id)}) — ${summarizeGuestAgentCounts(host.guests)}`,
      );
      for (const row of host.guests) {
        const cfg = row.configEnabled ? "enabled" : "disabled";
        log(
          `  vmid ${row.vmid} ${row.name} [${row.status}]: config ${cfg}, agent ${row.agentStatus}`,
        );
      }
    }
  }

  if (data.ok) log("QEMU guest agent report finished.");
  else log("QEMU guest agent report finished with issues — see warnings.");

  return { ok: data.ok, data };
}
