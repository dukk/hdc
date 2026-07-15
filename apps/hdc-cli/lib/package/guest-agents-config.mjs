import { join } from "node:path";
import { tryLoadClumpConfigFromClumpRoot } from "../clump-config.mjs";
import { isProxmoxConfigObject } from "hdc/clump/infrastructure/proxmox/lib/proxmox-config.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} cfg
 */
export function guestAgentsConfigFromProxmox(cfg) {
  if (!isProxmoxConfigObject(cfg)) {
    return { crowdsec: null, wazuh: null };
  }
  const provision = cfg.provision;
  if (!isObject(provision)) {
    return { crowdsec: null, wazuh: null };
  }
  const ga = provision.guest_agents;
  if (!isObject(ga)) {
    return { crowdsec: null, wazuh: null };
  }
  const cs = isObject(ga.crowdsec) ? ga.crowdsec : null;
  const wz = isObject(ga.wazuh) ? ga.wazuh : null;
  return { crowdsec: cs, wazuh: wz };
}

/**
 * Load guest_agents block from proxmox clump config.
 *
 * @param {string} proxmoxPackageRoot absolute path to clumps/infrastructure/proxmox
 */
export function loadGuestAgentsConfig(proxmoxPackageRoot) {
  const loaded = tryLoadClumpConfigFromClumpRoot(proxmoxPackageRoot, {
    exampleRel: "clumps/infrastructure/proxmox/config.example.json",
  });
  if (!loaded) {
    return { crowdsec: null, wazuh: null };
  }
  return guestAgentsConfigFromProxmox(loaded.data);
}

/**
 * @param {unknown} block
 */
export function guestAgentBlockEnabled(block) {
  if (!isObject(block)) return false;
  return block.enabled !== false && block.enabled !== 0;
}

/**
 * @param {unknown} block
 * @param {string} field
 */
export function guestAgentStringField(block, field) {
  if (!isObject(block)) return "";
  const v = block[field];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * @param {unknown} block
 * @param {string} field
 * @param {string} fallback
 */
export function guestAgentVaultKey(block, field, fallback) {
  const k = guestAgentStringField(block, field);
  return k || fallback;
}

/**
 * Resolve proxmox clump root from repo layout.
 *
 * @param {string} [proxmoxPackageRoot]
 * @param {string} [repoRoot]
 */
export function resolveProxmoxPackageRoot(proxmoxPackageRoot, repoRoot) {
  if (proxmoxPackageRoot) return proxmoxPackageRoot;
  if (repoRoot) return join(repoRoot, "packages", "infrastructure", "proxmox");
  return join(process.cwd(), "packages", "infrastructure", "proxmox");
}

/**
 * @param {unknown} block
 * @returns {string[]}
 */
export function guestAgentCollections(block) {
  if (!isObject(block)) return [];
  const raw = block.collections;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
}

/**
 * @param {unknown} block
 * @param {string[]} serviceIds from inventory system sidecar services[].id
 * @returns {string[]}
 */
export function guestAgentCollectionsForServices(block, serviceIds) {
  const base = guestAgentCollections(block);
  if (!isObject(block)) return base;
  const byService = block.collections_by_service;
  if (!isObject(byService)) return base;
  const extra = [];
  for (const sid of serviceIds) {
    const list = byService[sid];
    if (Array.isArray(list)) {
      for (const name of list) {
        if (typeof name === "string" && name.trim()) extra.push(name.trim());
      }
    }
  }
  return [...new Set([...base, ...extra])];
}

/**
 * @param {string | undefined} systemId
 */
export function isNagiosGuestSystem(systemId) {
  const id = String(systemId ?? "").trim();
  return /^nagios-[a-z]+$/.test(id);
}
