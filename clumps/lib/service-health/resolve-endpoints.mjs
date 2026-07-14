import { join } from "node:path";

import { loadManualSystemSidecar, primaryIpFromSystem } from "../inventory-sidecar.mjs";
import { tryLoadClumpConfigFromClumpRoot } from "../clump-run-config.mjs";
import { HEALTH_PATHS, DEFAULT_PORTS } from "./families.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} url
 */
export function hostnameFromUrl(url) {
  try {
    const u = new URL(String(url));
    return u.hostname || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @param {string} path
 */
export function joinUrlPath(url, path) {
  const base = String(url || "").replace(/\/+$/, "");
  const p = path && path.startsWith("/") ? path : `/${path || ""}`;
  if (!base) return p;
  if (p === "/") return base;
  return `${base}${p}`;
}

/**
 * Extract nested service block (e.g. cfg.defaults.vaultwarden or cfg.vaultwarden).
 * @param {Record<string, unknown>} cfg
 * @param {string} packageId
 */
export function serviceBlock(cfg, packageId) {
  const kebab = String(packageId || "");
  const snake = kebab.replace(/-/g, "_");
  const defaults = isObject(cfg.defaults) ? /** @type {Record<string, unknown>} */ (cfg.defaults) : {};
  for (const key of [kebab, snake]) {
    if (isObject(defaults[key])) return /** @type {Record<string, unknown>} */ (defaults[key]);
    if (isObject(cfg[key])) return /** @type {Record<string, unknown>} */ (cfg[key]);
  }
  return {};
}

/**
 * @param {Record<string, unknown>} svc
 */
export function publicUrlFromService(svc) {
  for (const key of ["public_url", "domain", "external_url", "admin_url", "api_url"]) {
    const v = svc[key];
    if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) return v.trim();
  }
  return null;
}

/**
 * @param {Record<string, unknown>} svc
 * @param {string} packageId
 */
export function portFromService(svc, packageId) {
  for (const key of ["host_port", "port", "listen_port", "http_port"]) {
    const n = Number(svc[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_PORTS[packageId] ?? 80;
}

/**
 * @param {Record<string, unknown>} deployment
 */
export function guestIpFromDeployment(deployment) {
  const proxmox = isObject(deployment.proxmox) ? /** @type {Record<string, unknown>} */ (deployment.proxmox) : {};
  for (const kind of ["lxc", "qemu"]) {
    const blk = isObject(proxmox[kind]) ? /** @type {Record<string, unknown>} */ (proxmox[kind]) : null;
    if (!blk) continue;
    if (typeof blk.ip === "string" && blk.ip.trim()) return blk.ip.trim().split("/")[0];
    if (typeof blk.ip_config === "string") {
      const m = blk.ip_config.match(/ip=([\d.]+)/i);
      if (m) return m[1];
    }
  }
  const configure = isObject(deployment.configure)
    ? /** @type {Record<string, unknown>} */ (deployment.configure)
    : {};
  const ssh = isObject(configure.ssh) ? /** @type {Record<string, unknown>} */ (configure.ssh) : {};
  if (typeof ssh.host === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(ssh.host.trim())) {
    return ssh.host.trim();
  }
  return null;
}

/**
 * Load nginx-waf LAN node IPs and site hostnames from config.
 * @param {string} repoRoot
 */
export function loadNginxWafEdge(repoRoot) {
  const wafRoot = join(repoRoot, "clumps", "services", "nginx-waf");
  const loaded = tryLoadClumpConfigFromClumpRoot(wafRoot, {
    exampleRel: "clumps/services/nginx-waf/config.example.json",
  });
  if (!loaded.ok || !isObject(loaded.data)) {
    return {
      ips: /** @type {string[]} */ ([]),
      sitesByHost: /** @type {Map<string, { siteId: string, hostNames: string[] }>} */ (new Map()),
    };
  }
  const cfg = /** @type {Record<string, unknown>} */ (loaded.data);
  /** @type {string[]} */
  const ips = [];
  /** @type {unknown[]} */
  const rootDeps = Array.isArray(cfg.deployments) ? cfg.deployments : [];
  const groups = Array.isArray(cfg.deployment_groups) ? cfg.deployment_groups : [];
  /** @type {unknown[]} */
  const allDeps = [...rootDeps];
  for (const g of groups) {
    if (!isObject(g)) continue;
    if (Array.isArray(g.deployments)) allDeps.push(...g.deployments);
  }
  for (const d of allDeps) {
    if (!isObject(d)) continue;
    const ip = guestIpFromDeployment(/** @type {Record<string, unknown>} */ (d));
    if (ip) ips.push(ip);
  }
  /** @type {Map<string, { siteId: string, hostNames: string[] }>} */
  const sitesByHost = new Map();
  for (const g of groups) {
    if (!isObject(g)) continue;
    const sites = Array.isArray(g.sites) ? g.sites : [];
    for (const s of sites) {
      if (!isObject(s)) continue;
      const siteId = typeof s.id === "string" ? s.id : "";
      const hosts = Array.isArray(s.host_names)
        ? s.host_names.filter((h) => typeof h === "string").map((h) => String(h).trim().toLowerCase())
        : [];
      for (const h of hosts) {
        sitesByHost.set(h, { siteId, hostNames: hosts });
      }
    }
  }
  return { ips: [...new Set(ips)], sitesByHost };
}

/**
 * @param {string} clumpRoot
 */
function tierFromClumpRoot(clumpRoot) {
  const norm = clumpRoot.replace(/\\/g, "/");
  if (norm.includes("/clients/")) return "clients";
  if (norm.includes("/infrastructure/")) return "infrastructure";
  return "services";
}

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.clumpRoot
 * @param {string} opts.packageId
 * @param {Record<string, unknown>} [opts.probe]
 * @param {string} [opts.instance]
 */
export function resolveHealthEndpoints(opts) {
  const packageId = opts.packageId;
  const tier = tierFromClumpRoot(opts.clumpRoot);
  const loaded = tryLoadClumpConfigFromClumpRoot(opts.clumpRoot, {
    exampleRel: `clumps/${tier}/${packageId}/config.example.json`,
  });
  const cfg = loaded.ok && isObject(loaded.data) ? /** @type {Record<string, unknown>} */ (loaded.data) : null;
  const probe = opts.probe ?? {};
  const path =
    typeof probe.path === "string" && probe.path ? probe.path : (HEALTH_PATHS[packageId] ?? "/");
  const svc = cfg ? serviceBlock(cfg, packageId) : {};
  const publicUrl =
    typeof probe.public_url === "string" ? probe.public_url : publicUrlFromService(svc);
  const port = typeof probe.port === "number" ? probe.port : portFromService(svc, packageId);
  const hostname =
    typeof probe.hostname === "string"
      ? probe.hostname
      : publicUrl
        ? hostnameFromUrl(publicUrl)
        : null;

  /** @type {Record<string, unknown>[]} */
  let deployments = cfg && Array.isArray(cfg.deployments) ? cfg.deployments.filter(isObject) : [];
  if (cfg && Array.isArray(cfg.deployment_groups)) {
    for (const g of cfg.deployment_groups) {
      if (!isObject(g)) continue;
      if (Array.isArray(g.deployments)) {
        deployments.push(...g.deployments.filter(isObject));
      }
    }
  }
  // Client packages use hosts[] instead of deployments[]
  if (!deployments.length && cfg && Array.isArray(cfg.hosts)) {
    deployments = cfg.hosts.filter(isObject).map((h) => {
      const host = /** @type {Record<string, unknown>} */ (h);
      const systemId =
        typeof host.system_id === "string"
          ? host.system_id
          : typeof host.id === "string"
            ? host.id
            : `${packageId}-host`;
      let ip = null;
      const access = isObject(host.access) ? /** @type {Record<string, unknown>} */ (host.access) : {};
      const nodes = Array.isArray(access.nodes) ? access.nodes : [];
      for (const n of nodes) {
        if (isObject(n) && typeof n.ip === "string" && n.ip.trim()) {
          ip = n.ip.trim();
          break;
        }
      }
      return {
        system_id: systemId,
        instance: typeof host.id === "string" ? host.id : systemId,
        mode: "client",
        _client_ip: ip,
        enabled: host.enabled !== false,
      };
    });
  }

  const instanceFilter = opts.instance ? String(opts.instance).trim().toLowerCase() : null;

  /** @type {object[]} */
  const instances = [];
  const list = deployments.length ? deployments : [{ system_id: `${packageId}-a`, _synthetic: true }];

  for (const d of list) {
    const dep = /** @type {Record<string, unknown>} */ (d);
    if (dep.enabled === false) continue;
    const systemId = typeof dep.system_id === "string" ? dep.system_id : `${packageId}-a`;
    const instanceId =
      typeof dep.instance === "string"
        ? dep.instance
        : systemId.replace(new RegExp(`^${packageId}-?`), "") || "a";
    if (
      instanceFilter &&
      instanceId.toLowerCase() !== instanceFilter &&
      systemId.toLowerCase() !== instanceFilter
    ) {
      continue;
    }
    let guestIp =
      typeof probe.guest_ip === "string"
        ? probe.guest_ip
        : typeof dep._client_ip === "string"
          ? dep._client_ip
          : guestIpFromDeployment(dep);
    if (!guestIp) {
      const sidecar = loadManualSystemSidecar(opts.repoRoot, systemId);
      guestIp = primaryIpFromSystem(sidecar);
    }
    const defaults =
      cfg && isObject(cfg.defaults) ? /** @type {Record<string, unknown>} */ (cfg.defaults) : {};
    const mode =
      typeof dep.mode === "string"
        ? dep.mode
        : typeof defaults.mode === "string"
          ? String(defaults.mode)
          : "proxmox-lxc";

    let vmid = null;
    let hostId = null;
    const px = isObject(dep.proxmox) ? /** @type {Record<string, unknown>} */ (dep.proxmox) : {};
    if (typeof px.host_id === "string") hostId = px.host_id;
    for (const kind of ["lxc", "qemu"]) {
      const blk = isObject(px[kind]) ? /** @type {Record<string, unknown>} */ (px[kind]) : null;
      const v = blk && Number(blk.vmid);
      if (Number.isFinite(v) && v > 0) vmid = v;
    }

    instances.push({
      id: instanceId,
      system_id: systemId,
      mode,
      guest_ip: guestIp,
      port,
      public_url: publicUrl,
      hostname,
      path,
      vmid,
      host_id: hostId,
    });
  }

  const edge = loadNginxWafEdge(opts.repoRoot);
  let wafSite = null;
  if (hostname && edge.sitesByHost.has(hostname.toLowerCase())) {
    wafSite = edge.sitesByHost.get(hostname.toLowerCase());
  }

  return {
    config_loaded: Boolean(cfg),
    path,
    public_url: publicUrl,
    hostname,
    port,
    waf_ips: edge.ips,
    waf_site: wafSite,
    instances,
  };
}
