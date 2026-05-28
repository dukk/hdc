import { vmSystemId } from "../../../../tools/hdc/lib/inventory-naming.mjs";
import { flagGet } from "../../../lib/parse-argv-flags.mjs";

const NGINX_WAF_ROLE = "nginx-waf";

/** Default trusted networks for internal_only location access. */
export const DEFAULT_TRUSTED_CIDRS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
];

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 */
function deepMerge(target, source) {
  for (const [key, val] of Object.entries(source)) {
    if (isObject(val) && isObject(target[key])) {
      deepMerge(/** @type {Record<string, unknown>} */ (target[key]), val);
    } else {
      target[key] = val;
    }
  }
  return target;
}

/**
 * @param {Record<string, unknown>} defaults
 * @param {Record<string, unknown>} entry
 */
function mergeDeploymentEntry(defaults, entry) {
  const base = structuredClone(defaults);
  deepMerge(base, entry);
  const systemId =
    typeof entry.system_id === "string" && entry.system_id.trim()
      ? entry.system_id.trim()
      : typeof base.system_id === "string" && base.system_id.trim()
        ? base.system_id.trim()
        : "";
  if (systemId) base.system_id = systemId;
  return base;
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function normalizeNginxWafConfig(cfg) {
  if (!isObject(cfg)) {
    throw new Error("nginx-waf config must be a JSON object");
  }
  const version = typeof cfg.schema_version === "number" ? cfg.schema_version : 1;
  if (!Array.isArray(cfg.deployments) || cfg.deployments.length === 0) {
    throw new Error("nginx-waf config needs deployments[] with at least one entry");
  }
  const defaults = isObject(cfg.defaults) ? structuredClone(cfg.defaults) : {};
  const raw = cfg.deployments.filter(isObject);
  const deployments = raw.map((entry) => mergeDeploymentEntry(defaults, entry));
  validateDeployments(deployments);
  const sites = Array.isArray(cfg.sites)
    ? cfg.sites.filter(isObject)
    : Array.isArray(defaults.sites)
      ? defaults.sites.filter(isObject)
      : [];
  const letsencrypt = isObject(cfg.letsencrypt)
    ? cfg.letsencrypt
    : isObject(defaults.letsencrypt)
      ? defaults.letsencrypt
      : {};
  const nginxWaf = isObject(cfg.nginx_waf)
    ? cfg.nginx_waf
    : isObject(defaults.nginx_waf)
      ? defaults.nginx_waf
      : {};
  return {
    schemaVersion: version >= 2 ? 2 : version,
    defaults,
    deployments,
    sites,
    letsencrypt,
    nginxWaf,
  };
}

/**
 * @param {Record<string, unknown>[]} deployments
 */
function validateDeployments(deployments) {
  const ids = new Set();
  let certPrimaryCount = 0;
  for (const d of deployments) {
    const sid = typeof d.system_id === "string" ? d.system_id.trim() : "";
    if (!sid) throw new Error("each deployment needs system_id");
    if (!/^vm-nginx-waf-[a-z]+$/.test(sid)) {
      throw new Error(`system_id ${JSON.stringify(sid)} must match vm-nginx-waf-<letter>`);
    }
    if (ids.has(sid)) throw new Error(`duplicate system_id ${JSON.stringify(sid)}`);
    ids.add(sid);
    const role = typeof d.role === "string" ? d.role.trim().toLowerCase() : "";
    if (role !== "cert-primary" && role !== "peer") {
      throw new Error(`${sid}: role must be cert-primary or peer`);
    }
    if (role === "cert-primary") certPrimaryCount += 1;
    const mode = typeof d.mode === "string" ? d.mode.trim() : "";
    if (mode === "proxmox-qemu" || mode === "configure-only") {
      const px = isObject(d.proxmox) ? d.proxmox : {};
      if (mode === "proxmox-qemu") {
        const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
        if (!hostId) throw new Error(`${sid}: proxmox.host_id required for proxmox-qemu`);
        const q = isObject(px.qemu) ? px.qemu : {};
        const vmid = typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
        if (!Number.isFinite(vmid) || vmid <= 0) {
          throw new Error(`${sid}: proxmox.qemu.vmid must be a positive number`);
        }
      }
    }
  }
  if (certPrimaryCount !== 1) {
    throw new Error(`deployments must include exactly one cert-primary (found ${certPrimaryCount})`);
  }
}

/**
 * @param {string | undefined} instance
 */
export function instanceFlagToSystemId(instance) {
  if (!instance) return undefined;
  const t = instance.trim();
  if (/^vm-nginx-waf-[a-z]+$/.test(t)) return t;
  return vmSystemId(NGINX_WAF_ROLE, t);
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {Record<string, string>} flags
 */
export function resolveNginxWafDeployments(cfg, flags) {
  const { deployments } = normalizeNginxWafConfig(cfg);
  let selectedId = flagGet(flags, "system-id", "system_id");
  const instance = flagGet(flags, "instance");
  if (!selectedId && instance) {
    selectedId = instanceFlagToSystemId(instance);
  }

  if (deployments.length === 1) {
    const d = deployments[0];
    if (selectedId && selectedId !== d.system_id) {
      throw new Error(
        `unknown system_id ${JSON.stringify(selectedId)} (only ${JSON.stringify(d.system_id)} configured)`,
      );
    }
    return [finalizeDeployment(d)];
  }

  if (!selectedId) {
    const sorted = [...deployments].sort((a, b) => {
      const ra = typeof a.role === "string" && a.role === "cert-primary" ? 0 : 1;
      const rb = typeof b.role === "string" && b.role === "cert-primary" ? 0 : 1;
      return ra - rb;
    });
    return sorted.map((d) => finalizeDeployment(d));
  }

  const d = deployments.find((x) => x.system_id === selectedId);
  if (!d) throw new Error(`unknown system_id ${JSON.stringify(selectedId)}`);
  return [finalizeDeployment(d)];
}

/**
 * @param {Record<string, unknown>} d
 */
function finalizeDeployment(d) {
  const mode = typeof d.mode === "string" ? d.mode.trim() : "configure-only";
  const roleRaw = typeof d.role === "string" ? d.role.trim().toLowerCase() : "peer";
  const role = roleRaw === "cert-primary" ? "cert-primary" : "peer";
  return {
    systemId: String(d.system_id),
    mode,
    role: /** @type {"cert-primary" | "peer"} */ (role),
    hostname: typeof d.hostname === "string" ? d.hostname.trim() : "",
    proxmox: isObject(d.proxmox) ? d.proxmox : null,
    configure: isObject(d.configure) ? d.configure : null,
    installEnabled: isObject(d.install) ? d.install.enabled !== false : true,
  };
}

/**
 * @param {ReturnType<typeof normalizeNginxWafConfig>} normalized
 */
export function nginxWafGlobalSettings(normalized) {
  const le = isObject(normalized.letsencrypt) ? normalized.letsencrypt : {};
  const dns = isObject(le.dns) ? le.dns : {};
  const nw = isObject(normalized.nginxWaf) ? normalized.nginxWaf : {};
  const ms = isObject(nw.modsecurity) ? nw.modsecurity : {};
  const challenge =
    typeof le.challenge === "string" && le.challenge.trim().toLowerCase() === "dns-01"
      ? "dns-01"
      : "http-01";
  return {
    sites: normalized.sites,
    challenge,
    email:
      typeof le.email === "string" && le.email.trim() ? le.email.trim() : "",
    emailVaultKey:
      typeof le.email_vault_key === "string" && le.email_vault_key.trim()
        ? le.email_vault_key.trim()
        : "HDC_NGINX_WAF_LE_EMAIL",
    staging: le.staging === true,
    certPrimarySystemId:
      typeof le.cert_primary_system_id === "string" && le.cert_primary_system_id.trim()
        ? le.cert_primary_system_id.trim()
        : "vm-nginx-waf-a",
    webroot:
      typeof le.webroot === "string" && le.webroot.trim()
        ? le.webroot.trim()
        : "/var/www/letsencrypt",
    dnsZone: typeof dns.zone === "string" ? dns.zone.trim() : "",
    dnsNameservers: Array.isArray(dns.nameservers)
      ? dns.nameservers.map((n) => String(n).trim()).filter(Boolean)
      : [],
    dnsTsigVaultKey:
      typeof dns.tsig_vault_key === "string" && dns.tsig_vault_key.trim()
        ? dns.tsig_vault_key.trim()
        : "HDC_BIND_TSIG_KEY",
    dnsKeyName:
      typeof dns.key_name === "string" && dns.key_name.trim()
        ? dns.key_name.trim()
        : "hdc-bind-xfer",
    modsecurityEnabled: ms.enabled !== false,
    modsecurityRuleEngine: (() => {
      const explicit =
        typeof ms.rule_engine === "string" && ms.rule_engine.trim()
          ? ms.rule_engine.trim()
          : "";
      if (explicit === "On" || explicit === "DetectionOnly" || explicit === "Off") {
        return explicit;
      }
      return le.staging === true ? "DetectionOnly" : "On";
    })(),
    modsecurityCrsSetup:
      typeof ms.crs_setup === "string" && ms.crs_setup.trim()
        ? ms.crs_setup.trim()
        : "/etc/modsecurity/crs/crs-setup.conf",
    modsecurityCrsRulesGlob:
      typeof ms.crs_rules_glob === "string" && ms.crs_rules_glob.trim()
        ? ms.crs_rules_glob.trim()
        : "/usr/share/modsecurity-crs/rules/*.conf",
    modsecurityUnicodeMap:
      typeof ms.unicode_map === "string" && ms.unicode_map.trim() ? ms.unicode_map.trim() : "",
    modsecurityAuditLog:
      typeof ms.audit_log === "string" && ms.audit_log.trim()
        ? ms.audit_log.trim()
        : "/var/log/nginx/modsec_audit.log",
    clientMaxBodySize:
      typeof nw.client_max_body_size === "string" && nw.client_max_body_size.trim()
        ? nw.client_max_body_size.trim()
        : "64m",
    proxyReadTimeout:
      typeof nw.proxy_read_timeout === "string" && nw.proxy_read_timeout.trim()
        ? nw.proxy_read_timeout.trim()
        : "300s",
    proxyConnectTimeout:
      typeof nw.proxy_connect_timeout === "string" && nw.proxy_connect_timeout.trim()
        ? nw.proxy_connect_timeout.trim()
        : "60s",
    trustedCidrs: parseTrustedCidrs(nw.trusted_cidrs, DEFAULT_TRUSTED_CIDRS),
    cloudflareIpv4: nw.cloudflare_ipv4 !== false,
    defaultClientIp: (() => {
      const raw =
        typeof nw.client_ip === "string" ? nw.client_ip.trim().toLowerCase() : "remote_addr";
      return raw === "cloudflare" ? "cloudflare" : "remote_addr";
    })(),
  };
}

/**
 * @param {unknown} raw
 * @param {string[]} fallback
 */
function parseTrustedCidrs(raw, fallback) {
  if (!Array.isArray(raw) || raw.length === 0) return [...fallback];
  return raw.map((c) => String(c).trim()).filter(Boolean);
}

/**
 * Per-site trusted CIDRs and client IP mode for geo / real_ip rendering.
 * @param {Record<string, unknown>} site
 * @param {ReturnType<typeof nginxWafGlobalSettings>} global
 */
export function resolveSiteAccessSettings(site, global) {
  const siteCidrs = parseTrustedCidrs(site.trusted_cidrs, []);
  const trustedCidrs = siteCidrs.length > 0 ? siteCidrs : global.trustedCidrs;
  const clientIpRaw =
    typeof site.client_ip === "string"
      ? site.client_ip.trim().toLowerCase()
      : global.defaultClientIp;
  const clientIp = clientIpRaw === "cloudflare" ? "cloudflare" : "remote_addr";
  return {
    trustedCidrs,
    clientIp,
    cloudflareIpv4: global.cloudflareIpv4,
  };
}

/**
 * @param {ReturnType<typeof resolveNginxWafDeployments>} deployments
 * @param {string} certPrimarySystemId
 */
export function findCertPrimaryDeployment(deployments, certPrimarySystemId) {
  const byId = deployments.find((d) => d.systemId === certPrimarySystemId);
  if (byId) return byId;
  const byRole = deployments.find((d) => d.role === "cert-primary");
  if (byRole) return byRole;
  throw new Error(`no cert-primary deployment (expected ${certPrimarySystemId})`);
}

/**
 * @param {ReturnType<typeof resolveNginxWafDeployments>} deployments
 * @param {ReturnType<typeof findCertPrimaryDeployment>} primary
 */
export function findPeerDeployment(deployments, primary) {
  const peer = deployments.find((d) => d.systemId !== primary.systemId);
  return peer ?? null;
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} [siteId]
 */
export function resolveSites(cfg, siteId) {
  const { sites } = normalizeNginxWafConfig(cfg);
  if (!siteId) return sites;
  const id = siteId.trim();
  const filtered = sites.filter((s) => typeof s.id === "string" && s.id.trim() === id);
  if (!filtered.length) throw new Error(`unknown site id ${JSON.stringify(id)}`);
  return filtered;
}

/**
 * SSH target from deployment configure block.
 * @param {ReturnType<typeof finalizeDeployment>} deployment
 */
export function sshTargetFromDeployment(deployment) {
  const cfg = deployment.configure;
  const ssh = isObject(cfg) && isObject(cfg.ssh) ? cfg.ssh : {};
  const user = typeof ssh.user === "string" && ssh.user.trim() ? ssh.user.trim() : "root";
  const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : "";
  if (!host) throw new Error(`${deployment.systemId}: configure.ssh.host required`);
  return { user, host };
}
