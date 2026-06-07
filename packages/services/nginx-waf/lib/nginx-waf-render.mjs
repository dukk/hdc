import {
  normalizeSourceCidr,
  parseIpv4Cidr,
} from "../../../infrastructure/proxmox/lib/proxmox-host-firewall-maintain.mjs";
import { CLOUDFLARE_IPV4_CIDRS } from "./cloudflare-ip-ranges.mjs";

/** HDC-managed ModSecurity main config (includes OWASP CRS). */
export const MODSECURITY_RULES_FILE = "/etc/modsecurity/hdc-waf.conf";

export const DEFAULT_CRS_SETUP = "/etc/modsecurity/crs/crs-setup.conf";
export const DEFAULT_CRS_RULES_GLOB = "/usr/share/modsecurity-crs/rules/*.conf";
/** Optional; Ubuntu 24.04+ modsecurity-crs omits this file — leave unset to skip SecUnicodeMapFile. */
export const DEFAULT_UNICODE_MAP = "";
export const DEFAULT_MODSEC_AUDIT_LOG = "/var/log/nginx/modsec_audit.log";

export const TRUSTED_GEO_VARIABLE = "$hdc_trusted_internal";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string[]} cidrs
 * @param {string} context
 */
export function validateTrustedCidrs(cidrs, context) {
  if (!cidrs.length) {
    throw new Error(`${context}: trusted_cidrs must include at least one CIDR`);
  }
  for (const cidr of cidrs) {
    const normalized = normalizeSourceCidr(cidr);
    if (!parseIpv4Cidr(normalized)) {
      throw new Error(`${context}: invalid trusted CIDR ${JSON.stringify(cidr)}`);
    }
  }
}

/**
 * @param {Record<string, unknown>[]} locations
 */
export function siteHasInternalOnlyAccess(locations) {
  return locations.some((loc) => {
    const access = isObject(loc.access) ? loc.access : null;
    return access?.policy === "internal_only";
  });
}

/**
 * @param {Record<string, unknown>} loc
 * @param {string} context
 * @returns {{ denyStatus: 401 | 404 } | null}
 */
export function parseLocationAccess(loc, context) {
  const access = isObject(loc.access) ? loc.access : null;
  if (!access) return null;
  const policy = typeof access.policy === "string" ? access.policy.trim() : "";
  if (policy !== "internal_only") {
    throw new Error(`${context}: location access.policy must be internal_only`);
  }
  const denyRaw = access.deny_status;
  const denyStatus = denyRaw === 401 || denyRaw === 404 ? denyRaw : null;
  if (!denyStatus) {
    throw new Error(`${context}: location access.deny_status must be 401 or 404`);
  }
  return { denyStatus };
}

/**
 * @param {object} opts
 * @param {string[]} opts.cidrs
 * @param {"remote_addr" | "cloudflare"} opts.clientIp
 */
export function renderTrustedGeo(opts) {
  const { cidrs, clientIp } = opts;
  const geoSource = clientIp === "cloudflare" ? "$realip_remote_addr" : "$remote_addr";
  const lines = [`geo ${geoSource} $hdc_trusted_internal {`, "    default 0;"];
  for (const cidr of cidrs) {
    lines.push(`    ${normalizeSourceCidr(cidr)} 1;`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

/**
 * @param {boolean} cloudflareIpv4
 */
export function renderCloudflareRealIp(cloudflareIpv4) {
  if (!cloudflareIpv4) {
    throw new Error("client_ip cloudflare requires defaults.nginx_waf.cloudflare_ipv4 (not false)");
  }
  const lines = ["    # Cloudflare client IP (hdc nginx-waf)"];
  for (const cidr of CLOUDFLARE_IPV4_CIDRS) {
    lines.push(`    set_real_ip_from ${cidr};`);
  }
  lines.push(
    "    real_ip_header CF-Connecting-IP;",
    "    real_ip_recursive on;",
  );
  return `${lines.join("\n")}\n`;
}

/**
 * @param {object} opts
 * @param {string} [opts.wafNodeId]
 */
export function renderProxyHeaders(opts) {
  const { wafNodeId } = opts;
  const nodeLine =
    typeof wafNodeId === "string" && wafNodeId.trim()
      ? `
        proxy_set_header X-HDC-Nginx-Waf-Node ${wafNodeId.trim()};`
      : "";
  return `
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;${nodeLine}`;
}

/**
 * @param {object} opts
 * @param {string} opts.ruleEngine
 * @param {string} opts.crsSetup
 * @param {string} opts.crsRulesGlob
 * @param {string} opts.unicodeMap
 * @param {string} opts.auditLog
 */
export function renderModsecurityMainConf(opts) {
  const { ruleEngine, crsSetup, crsRulesGlob, unicodeMap, auditLog } = opts;
  return [
    "# Managed by hdc nginx-waf — do not edit manually",
    `SecRuleEngine ${ruleEngine}`,
    "SecRequestBodyAccess On",
    "SecResponseBodyAccess Off",
    "SecAuditEngine RelevantOnly",
    `SecAuditLog ${auditLog}`,
    ...(unicodeMap && unicodeMap.trim() ? [`SecUnicodeMapFile ${unicodeMap.trim()} 20127`] : []),
    `Include ${crsSetup}`,
    `Include ${crsRulesGlob}`,
    "",
  ].join("\n");
}

/**
 * @param {Record<string, unknown>} site
 */
export function siteId(site) {
  const id = typeof site.id === "string" ? site.id.trim() : "";
  if (!id) throw new Error("site needs id");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`site id ${JSON.stringify(id)} must be lowercase slug`);
  }
  return id;
}

/**
 * @param {Record<string, unknown>} site
 */
export function serverNames(site) {
  const names = Array.isArray(site.server_names)
    ? site.server_names.map((n) => String(n).trim()).filter(Boolean)
    : [];
  if (!names.length) throw new Error(`${siteId(site)}: server_names required`);
  return names;
}

/**
 * @param {Record<string, unknown>[]} sites
 */
export function tlsDomainsFromSites(sites) {
  /** @type {string[]} */
  const domains = [];
  for (const site of sites) {
    const tls = isObject(site.tls) ? site.tls : {};
    if (tls.enabled === false) continue;
    const certName =
      typeof tls.cert_name === "string" && tls.cert_name.trim()
        ? tls.cert_name.trim()
        : serverNames(site)[0];
    if (certName && !domains.includes(certName)) domains.push(certName);
  }
  return domains;
}

/**
 * @param {Record<string, unknown>[]} sites
 */
export function sitesNeedWebsocketMap(sites) {
  for (const site of sites) {
    const locations = Array.isArray(site.locations) ? site.locations.filter(isObject) : [];
    if (locations.some((loc) => loc.websocket === true)) {
      return true;
    }
  }
  return false;
}

/** @returns {string} */
export function renderWebsocketUpgradeMap() {
  return `map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

`;
}

/**
 * @param {object} opts
 * @param {boolean} opts.modsecurityEnabled
 * @param {boolean} [opts.websocketMapEnabled]
 */
export function renderHdcNginxInclude(opts) {
  const { modsecurityEnabled, websocketMapEnabled = false } = opts;
  const lines = [
    "# Managed by hdc nginx-waf — do not edit manually",
    ...(websocketMapEnabled
      ? [
          "map $http_upgrade $connection_upgrade {",
          "    default upgrade;",
          "    ''      close;",
          "}",
          "",
        ]
      : []),
    "client_max_body_size 64m;",
    "proxy_read_timeout 300s;",
    "proxy_connect_timeout 60s;",
  ];
  if (modsecurityEnabled) {
    lines.push('modsecurity on;', `modsecurity_rules_file ${MODSECURITY_RULES_FILE};`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} opts.site
 * @param {boolean} opts.modsecurityEnabled
 * @param {boolean} opts.http01Acme
 * @param {string} opts.webroot
 * @param {boolean} [opts.deferTlsUntilCertExists] HTTP-only until LE cert exists (http-01 bootstrap).
 * @param {string[]} [opts.trustedCidrs]
 * @param {"remote_addr" | "cloudflare"} [opts.clientIp]
 * @param {boolean} [opts.cloudflareIpv4]
 * @param {string} [opts.wafNodeId]
 */
export function renderSiteVhost(opts) {
  const {
    site,
    modsecurityEnabled,
    http01Acme,
    webroot,
    deferTlsUntilCertExists = false,
    trustedCidrs = [],
    clientIp = "remote_addr",
    cloudflareIpv4 = true,
    wafNodeId,
  } = opts;
  const id = siteId(site);
  const names = serverNames(site);
  const listen = Array.isArray(site.listen)
    ? site.listen.map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0)
    : [80, 443];
  const upstream =
    typeof site.upstream === "string" && site.upstream.trim() ? site.upstream.trim() : "";
  if (!upstream) throw new Error(`${id}: upstream required`);

  const tls = isObject(site.tls) ? site.tls : {};
  const tlsEnabled = tls.enabled !== false && !deferTlsUntilCertExists;
  const certName =
    typeof tls.cert_name === "string" && tls.cert_name.trim()
      ? tls.cert_name.trim()
      : names[0];
  const waf = isObject(site.waf) ? site.waf : {};
  const wafOn = waf.enabled !== false && modsecurityEnabled;

  const locations = Array.isArray(site.locations) ? site.locations.filter(isObject) : [];
  const needsTrustedGeo = siteHasInternalOnlyAccess(locations);
  if (needsTrustedGeo) {
    validateTrustedCidrs(trustedCidrs, id);
  }

  const renderLoc = (/** @type {Record<string, unknown>} */ loc) =>
    renderLocationBlock(loc, upstream, wafOn, id, needsTrustedGeo, wafNodeId);

  const locBlocks =
    locations.length > 0
      ? locations.map(renderLoc)
      : [
          renderLocationBlock({ path: "/", proxy_headers: true }, upstream, wafOn, id, false, wafNodeId),
        ];

  const trustedGeoBlock = needsTrustedGeo
    ? `${renderTrustedGeo({ cidrs: trustedCidrs, clientIp })}\n`
    : "";
  const cloudflareRealIp =
    clientIp === "cloudflare" ? renderCloudflareRealIp(cloudflareIpv4) : "";

  /** @type {string[]} */
  const blocks = [];

  if (listen.includes(80)) {
    const acme =
      http01Acme
        ? `
    location ^~ /.well-known/acme-challenge/ {
        root ${webroot};
        default_type "text/plain";
    }`
        : "";
    const locBlocksHttp =
      locations.length > 0
        ? locations.map(renderLoc)
        : [
            renderLocationBlock({ path: "/", proxy_headers: true }, upstream, wafOn, id, false, wafNodeId),
          ];
    const httpServe = deferTlsUntilCertExists
      ? locBlocksHttp.join("\n")
      : `
    location / {
        return 301 https://$host$request_uri;
    }`;
    blocks.push(`server {
    listen 80;
    listen [::]:80;
    server_name ${names.join(" ")};
${acme}${cloudflareRealIp}${httpServe}
}
`);
  }

  if (listen.includes(443) && tlsEnabled) {
    const secRules =
      modsecurityEnabled && !wafOn
        ? `
    modsecurity off;`
        : "";
    blocks.push(`server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${names.join(" ")};
    ssl_certificate /etc/letsencrypt/live/${certName}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${certName}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;${secRules}
${cloudflareRealIp}${locBlocks.join("\n")}
}
`);
  } else if (!listen.includes(80)) {
    blocks.push(`server {
    listen ${listen[0]};
    server_name ${names.join(" ")};
${locBlocks.join("\n")}
}
`);
  }

  return `# hdc site ${id}\n${trustedGeoBlock}${blocks.join("\n")}`;
}

/**
 * @param {Record<string, unknown>} loc
 * @param {string} upstream
 * @param {boolean} wafOn
 * @param {string} siteContext
 * @param {boolean} trustedGeoEnabled
 * @param {string} [wafNodeId]
 */
function renderLocationBlock(loc, upstream, _wafOn, siteContext, trustedGeoEnabled, wafNodeId) {
  const path = typeof loc.path === "string" && loc.path.trim() ? loc.path.trim() : "/";
  const access = parseLocationAccess(loc, siteContext);
  const accessGuard =
    access && trustedGeoEnabled
      ? `
        if ($hdc_trusted_internal = 0) { return ${access.denyStatus}; }`
      : "";
  const headers = loc.proxy_headers !== false;
  const headerLines = headers ? renderProxyHeaders({ wafNodeId }) : "";
  const websocket = loc.websocket === true;
  const websocketLines = websocket
    ? `
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_cache_bypass $http_upgrade;`
    : "";
  return `    location ${path} {${accessGuard}
        proxy_pass ${upstream};${headerLines}${websocketLines}
    }`;
}

/**
 * @param {object} opts
 * @param {string} opts.dnsZone
 * @param {string} opts.dnsNameserver
 * @param {string} opts.keyName
 * @param {string} opts.tsigSecret
 */
export function renderCertbotDnsCredentials(opts) {
  const { dnsZone, dnsNameserver, keyName, tsigSecret } = opts;
  return [
    `dns_rfc2136_server = ${dnsNameserver}`,
    `dns_rfc2136_port = 53`,
    `dns_rfc2136_name = ${keyName}`,
    `dns_rfc2136_secret = ${tsigSecret}`,
    `dns_rfc2136_algorithm = HMAC-SHA256`,
    `dns_rfc2136_zone = ${dnsZone}`,
  ].join("\n");
}

/**
 * @param {object} opts
 * @param {string} opts.peerUser
 * @param {string} opts.peerHost
 */
export function renderCertSyncScript(opts) {
  const { peerUser, peerHost } = opts;
  const peer = `${peerUser}@${peerHost}`;
  return `#!/bin/bash
# hdc nginx-waf — sync Let's Encrypt certs to peer and reload nginx
set -euo pipefail
PEER=${JSON.stringify(peer)}
RSYNC_OPTS="-az --delete"
for dir in live archive; do
  if [ -d "/etc/letsencrypt/\${dir}" ]; then
    rsync \${RSYNC_OPTS} "/etc/letsencrypt/\${dir}/" "\${PEER}:/etc/letsencrypt/\${dir}/"
  fi
done
nginx -t
nginx -s reload
ssh "\${PEER}" 'nginx -t && nginx -s reload'
`;
}
