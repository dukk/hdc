import { readdirSync } from "node:fs";
import { join } from "node:path";

import { primaryIpFromSystem } from "../../../clumps/lib/inventory-sidecar.mjs";
import { controllerFromPackageConfig } from "../../../clumps/infrastructure/unifi-network/lib/unifi-config.mjs";
import { UNIFI_API_KEY_VAULT_KEY } from "../../../clumps/infrastructure/unifi-network/lib/vault-deps.mjs";
import {
  DEFAULT_AUDIOBOOKSHELF_TOKEN_VAULT_KEY,
} from "../../../clumps/services/homepage/lib/homepage-audiobookshelf-widget.mjs";
import {
  DEFAULT_HA_TOKEN_VAULT_KEY,
} from "../../../clumps/services/homepage/lib/homepage-homeassistant-widget.mjs";
import { DEFAULT_PLEX_TOKEN_VAULT_KEY } from "../../../clumps/services/homepage/lib/homepage-plex-widget.mjs";
import {
  ipFromCidr,
  isObject,
  serviceUrlFromHostPort,
  vaultKeyFromWidget,
} from "../../../clumps/services/homepage/lib/homepage-widget-utils.mjs";
import { discoverManifests, manifestId } from "../manifests.mjs";
import { clumpsDir, repoRoot } from "../paths.mjs";
import { loadClumpConfigFromClumpRoot } from "./clump-config.mjs";
import { readResolvedRepoJson, resolveRepoFile } from "./private-repo.mjs";

const PLACEHOLDER_HOST_RE =
  /(?:^|\.)example\.invalid$|REPLACE_DOMAIN|\.example\.test$/i;

const SKIP_KEY_PATTERNS = [
  /^HDC_USER_HDC_PASSWORD_/,
  /^HDC_POSTFIX_RELAY_/,
  /^HDC_BIND_TSIG_KEY$/,
  /^HDC_.*_WEBHOOK_URL$/,
  /^HDC_OPS_DISCORD_WEBHOOK_URL$/,
  /^HDC_.*_ENROLL_KEY$/,
  /^HDC_WIREGUARD_/,
  /^HDC_CLOUDFLARE_/,
  /^HDC_AWS_/,
  /^HDC_AZURE_/,
  /^HDC_GCP_/,
  /^HDC_OCI_/,
  /^HDC_SMTP2GO_/,
  /^HDC_OPENROUTER_MANAGEMENT_/,
  /^HDC_UPTIMEROBOT_/,
  /^HDC_GLOBALPING_ADOPTION_TOKEN$/,
  /^HDC_PROXMOX_SSH_/,
  /^HDC_PROXMOX_LXC_ROOT_PASSWORD$/,
  /^HDC_PROXMOX_USER_/,
  /^HDC_SYNOLOGY_SSH_/,
  /^HDC_WINRM_/,
  /^HDC_PSEXEC_PATH$/,
  /^HDC_TWILIO_ACCOUNT_/,
  /^HDC_TWILIO_AUTH_/,
  /^HDC_TWILIO_SIP_/,
  /^HDC_VAULTWARDEN_MASTER_PASSWORD$/,
  /^HDC_VAULTWARDEN_KEY_/,
  /^HDC_VAULTWARDEN_ADMIN_TOKEN$/,
  /^HDC_REDIS_PASSWORD$/,
  /^HDC_VALKEY_PASSWORD$/,
  /^HDC_POSTGRESQL_REPLICATION_PASSWORD$/,
  /^HDC_CASSANDRA_/,
  /^HDC_MAILCOW_DBPASS$/,
  /^HDC_MAILCOW_DBROOT$/,
  /^HDC_MAILCOW_REDISPASS$/,
  /^HDC_MAILCOW_MAILBOX_/,
  /^HDC_N8N_ENCRYPTION_KEY$/,
  /^HDC_PAPERCLIP_BETTER_AUTH_SECRET$/,
  /^HDC_PAPERCLIP_DB_PASSWORD$/,
  /^HDC_PAPERCLIP_.*_API_KEY$/,
  /^HDC_PAPERCLIP_AGENT_BRIDGE_SECRET$/,
  /^HDC_HERMES_DASHBOARD_AUTH_SECRET$/,
  /^HDC_HERMES_OPENROUTER_API_KEY$/,
  /^HDC_HERMES_DISCORD_BOT_TOKEN$/,
  /^HDC_HDC_RUNNER_UI_SESSION_SECRET$/,
  /^HDC_HDC_RUNNER_API_TOKEN$/,
  /^HDC_CURSOR_API_KEY$/,
  /^HDC_OPENROUTER_API_KEY$/,
  /^HDC_LITELLM_SALT_KEY$/,
  /^HDC_LITELLM_DB_PASSWORD$/,
  /^HDC_LITELLM_MASTER_KEY$/,
  /^HDC_SEARXNG_SECRET$/,
  /^HDC_SCANOPY_POSTGRES_PASSWORD$/,
  /^HDC_POSTIZ_JWT_SECRET$/,
  /^HDC_POSTIZ_DB_PASSWORD$/,
  /^HDC_DOCUSEAL_SECRET_KEY_BASE$/,
  /^HDC_DOCUSEAL_DB_PASSWORD$/,
  /^HDC_DAWARICH_SECRET_KEY_BASE$/,
  /^HDC_DAWARICH_DB_PASSWORD$/,
  /^HDC_AFFINE_DB_PASSWORD$/,
  /^HDC_TWENTY_ENCRYPTION_KEY$/,
  /^HDC_TWENTY_DB_PASSWORD$/,
  /^HDC_VIKUNJA_JWT_SECRET$/,
  /^HDC_VIKUNJA_DB_PASSWORD$/,
  /^HDC_LISTMONK_DB_PASSWORD$/,
  /^HDC_SHLINK_DB_PASSWORD$/,
  /^HDC_SHLINK_GEOLITE_LICENSE_KEY$/,
  /^HDC_UNLEASH_DB_PASSWORD$/,
  /^HDC_ZABBIX_DB_/,
  /^HDC_SOLIDTIME_DB_PASSWORD$/,
  /^HDC_IMMICH_DB_PASSWORD$/,
  /^HDC_KEYCLOAK_DB_PASSWORD$/,
  /^HDC_WAZUH_AGENT_PASSWORD$/,
  /^HDC_CROWDSEC_BOUNCER_KEY$/,
  /^HDC_CROWDSEC_ENROLL_KEY$/,
  /^HDC_MOSQUITTO_PASSWORD_/,
  /^HDC_MOSQUITTO_ACME_EMAIL$/,
  /^HDC_KEEPALIVED_AUTH_PASS$/,
  /^HDC_NGINX_LE_EMAIL$/,
  /^HDC_NGINX_WAF_LE/,
  /^HDC_RUSTFS_/,
  /^HDC_OPENCLAW_/,
  /^HDC_RACKULA_API_WRITE_TOKEN$/,
  /^HDC_UPTIME_KUMA_API_KEY$/,
  /^HDC_UPTIME_KUMA_USERNAME/,
];

export function shouldSkipVaultKeyUri(key) {
  if (!key.startsWith("HDC_")) return true;
  return SKIP_KEY_PATTERNS.some((re) => re.test(key));
}

export function normalizeServiceUrl(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  let url = s;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url.replace(/\/+$/, "")}`;
  }
  try {
    const u = new URL(url);
    if (PLACEHOLDER_HOST_RE.test(u.hostname)) return null;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return null;
    if (/\.(7z|zip|iso|tar|gz|deb|rpm|spk)$/i.test(u.pathname)) return null;
    return u.toString().replace(/\/+$/, "") || null;
  } catch {
    return null;
  }
}

export function urlFromHostPort(host, port, scheme = "http") {
  const h = typeof host === "string" ? host.trim().split("/")[0]?.trim() : "";
  const p = Number.isFinite(port) && port >= 1 && port <= 65535 ? Math.floor(port) : null;
  if (!h || !/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || p === null) return null;
  return `${scheme}://${h}:${p}`;
}

function urlsFromContextObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const row = /** @type {Record<string, unknown>} */ (obj);
  const out = [];
  for (const field of [
    "public_url",
    "domain",
    "admin_url",
    "external_url",
    "s3_public_url",
    "console_public_url",
    "url",
  ]) {
    const u = normalizeServiceUrl(typeof row[field] === "string" ? row[field] : null);
    if (u) out.push(u);
  }
  const webClient = row.web_client;
  if (webClient && typeof webClient === "object" && !Array.isArray(webClient)) {
    const wu = normalizeServiceUrl(
      typeof /** @type {Record<string, unknown>} */ (webClient).public_url === "string"
        ? /** @type {Record<string, unknown>} */ (webClient).public_url
        : null,
    );
    if (wu) out.push(wu);
  }
  return out;
}

function ipFromIpConfig(ipConfig) {
  const raw = typeof ipConfig === "string" ? ipConfig.trim() : "";
  if (!raw || /^dhcp$/i.test(raw)) return null;
  const addrPart = raw.split(",")[0]?.trim() ?? "";
  const ip = addrPart.split("/")[0]?.trim() ?? "";
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
}

function hostPortFromBlock(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  const row = /** @type {Record<string, unknown>} */ (block);
  for (const svcKey of Object.keys(row)) {
    const svc = row[svcKey];
    if (!svc || typeof svc !== "object" || Array.isArray(svc)) continue;
    const svcRow = /** @type {Record<string, unknown>} */ (svc);
    for (const portKey of ["host_port", "port"]) {
      const portRaw = svcRow[portKey];
      const p = typeof portRaw === "number" ? portRaw : Number(portRaw);
      if (Number.isFinite(p) && p > 0) return Math.floor(p);
    }
    const web = svcRow.web;
    if (web && typeof web === "object" && !Array.isArray(web)) {
      for (const portKey of ["host_port", "port"]) {
        const portRaw = /** @type {Record<string, unknown>} */ (web)[portKey];
        const p = typeof portRaw === "number" ? portRaw : Number(portRaw);
        if (Number.isFinite(p) && p > 0) return Math.floor(p);
      }
    }
  }
  return null;
}

const DEPLOYMENT_URL_SKIP_KEYS = new Set([
  "monitors",
  "notifications",
  "status_pages",
  "tags",
  "monitor_groups",
]);

function urlsFromDeployment(deployment, defaults, options = {}) {
  const includeDefaultUrls = options.includeDefaultUrls !== false;
  if (!deployment || typeof deployment !== "object" || Array.isArray(deployment)) {
    return { urls: [], ip: null, hostPort: null, systemId: "" };
  }
  const dep = /** @type {Record<string, unknown>} */ (deployment);
  const urls = [];
  const blocks = includeDefaultUrls ? [defaults, dep] : [dep];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    urls.push(...urlsFromContextObject(block));
    for (const svcKey of Object.keys(block)) {
      if (DEPLOYMENT_URL_SKIP_KEYS.has(svcKey)) continue;
      const svc = block[svcKey];
      if (svc && typeof svc === "object" && !Array.isArray(svc)) {
        urls.push(...urlsFromContextObject(svc));
      }
    }
  }
  let ip = null;
  const configure = dep.configure;
  if (configure && typeof configure === "object" && !Array.isArray(configure)) {
    const ssh = /** @type {Record<string, unknown>} */ (configure).ssh;
    if (ssh && typeof ssh === "object" && !Array.isArray(ssh)) {
      const host = typeof ssh.host === "string" ? ssh.host.trim() : "";
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) ip = host;
    }
  }
  const proxmox = dep.proxmox;
  if (!ip && proxmox && typeof proxmox === "object" && !Array.isArray(proxmox)) {
    for (const block of [
      /** @type {Record<string, unknown>} */ (proxmox).lxc,
      /** @type {Record<string, unknown>} */ (proxmox).qemu,
    ]) {
      if (block && typeof block === "object" && !Array.isArray(block)) {
        const fromCfg = ipFromIpConfig(
          typeof block.ip_config === "string"
            ? block.ip_config
            : typeof block.ip === "string"
              ? block.ip
              : "",
        );
        if (fromCfg) ip = fromCfg;
      }
    }
  }
  const systemId = typeof dep.system_id === "string" ? dep.system_id.trim() : "";
  const hostPort = hostPortFromBlock(defaults) ?? hostPortFromBlock(dep);
  return { urls, ip, hostPort, systemId };
}

function deploymentForVaultKey(vaultKey, deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) return null;
  if (deployments.length === 1) {
    const only = deployments[0];
    return only && typeof only === "object" && !Array.isArray(only) ? only : null;
  }
  const m = vaultKey.match(/_([A-Z0-9]+(?:_[A-Z0-9]+)*)$/);
  if (!m) return null;
  const suffix = m[1].toLowerCase().replace(/_/g, "-");
  for (const d of deployments) {
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    const row = /** @type {Record<string, unknown>} */ (d);
    const id = typeof row.id === "string" ? row.id.trim().toLowerCase() : "";
    const instance = typeof row.instance === "string" ? row.instance.trim().toLowerCase() : "";
    const systemId = typeof row.system_id === "string" ? row.system_id.trim().toLowerCase() : "";
    if (
      id === suffix ||
      instance === suffix ||
      id.endsWith(`-${suffix}`) ||
      systemId === suffix ||
      systemId.endsWith(`-${suffix}`)
    ) {
      return row;
    }
  }
  return null;
}

function addVaultKeyUris(map, key, urls) {
  if (shouldSkipVaultKeyUri(key) || urls.length === 0) return;
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  for (const u of urls) {
    const n = normalizeServiceUrl(u);
    if (n) set.add(n);
  }
}

function setVaultKeyUris(map, key, urls) {
  if (shouldSkipVaultKeyUri(key) || urls.length === 0) return;
  const set = new Set();
  for (const u of urls) {
    const n = normalizeServiceUrl(u);
    if (n) set.add(n);
  }
  if (set.size > 0) map.set(key, set);
}

function extractDefaultPackageUrls(defaults) {
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) return [];
  const urls = [];
  urls.push(...urlsFromContextObject(defaults));
  for (const val of Object.values(defaults)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      urls.push(...urlsFromContextObject(val));
    }
  }
  return urls;
}

function vaultKeyContextUrls(ctx) {
  /** @type {string[]} */
  const out = [];
  out.push(...urlsFromContextObject(ctx));
  if (Array.isArray(ctx._urls)) out.push(...ctx._urls);
  if (Array.isArray(ctx._packageDefaultUrls)) out.push(...ctx._packageDefaultUrls);
  return out;
}

function walkConfigNode(node, ctx, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkConfigNode(item, ctx, out);
    return;
  }
  const obj = /** @type {Record<string, unknown>} */ (node);
  const nextCtx = { ...ctx, _urls: [...(Array.isArray(ctx._urls) ? ctx._urls : [])] };
  if (typeof obj.system_id === "string" && obj.system_id.trim()) {
    nextCtx._packageDefaultUrls = [];
  }
  for (const field of ["public_url", "domain", "admin_url", "external_url", "api_url"]) {
    if (typeof obj[field] === "string" && obj[field].trim()) {
      nextCtx[field] = obj[field];
      const u = normalizeServiceUrl(obj[field]);
      if (u) nextCtx._urls.push(u);
    }
  }
  if (obj.web_client && typeof obj.web_client === "object" && !Array.isArray(obj.web_client)) {
    nextCtx.web_client = obj.web_client;
    for (const u of urlsFromContextObject(obj.web_client)) nextCtx._urls.push(u);
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const u of urlsFromContextObject(val)) nextCtx._urls.push(u);
    }
  }
  for (const [key, val] of Object.entries(obj)) {
    if (key.endsWith("_vault_key") && typeof val === "string" && val.trim().startsWith("HDC_")) {
      const vaultKey = val.trim();
      if (!shouldSkipVaultKeyUri(vaultKey)) {
        addVaultKeyUris(out, vaultKey, vaultKeyContextUrls(nextCtx));
      }
    }
    walkConfigNode(val, nextCtx, out);
  }
}

function loadNginxWafIndex(publicRoot, env = process.env) {
  const hostnameToUrls = new Map();
  const pkgRoot = join(clumpsDir(publicRoot), "services", "nginx-waf");
  let data;
  try {
    data = loadClumpConfigFromClumpRoot(pkgRoot, {
      publicRoot,
      env,
      bootstrapFromExample: false,
    }).data;
  } catch {
    return { hostnameToUrls };
  }
  const groups = Array.isArray(data.deployment_groups) ? data.deployment_groups : [];
  for (const group of groups) {
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    const sites = /** @type {Record<string, unknown>} */ (group).sites;
    if (!Array.isArray(sites)) continue;
    for (const site of sites) {
      if (!site || typeof site !== "object" || Array.isArray(site)) continue;
      const row = /** @type {Record<string, unknown>} */ (site);
      const hostNames = Array.isArray(row.host_names) ? row.host_names : [];
      const tls = row.tls && typeof row.tls === "object" ? row.tls : {};
      const tlsEnabled = tls.enabled !== false;
      const siteUrls = [];
      for (const hn of hostNames) {
        if (typeof hn !== "string" || !hn.trim()) continue;
        const url = normalizeServiceUrl(tlsEnabled ? `https://${hn.trim()}` : `http://${hn.trim()}`);
        if (url) siteUrls.push(url);
      }
      for (const u of siteUrls) {
        try {
          const host = new URL(u).hostname;
          let set = hostnameToUrls.get(host);
          if (!set) {
            set = new Set();
            hostnameToUrls.set(host, set);
          }
          for (const su of siteUrls) set.add(su);
        } catch {
          // ignore
        }
      }
    }
  }
  return { hostnameToUrls };
}

function expandWithNginxAliases(urls, nginxIndex) {
  const out = new Set();
  for (const u of urls) {
    const n = normalizeServiceUrl(u);
    if (n) out.add(n);
    try {
      const host = new URL(n ?? u).hostname;
      const aliases = nginxIndex.hostnameToUrls.get(host);
      if (aliases) for (const a of aliases) out.add(a);
    } catch {
      // ignore
    }
  }
  return [...out];
}

function loadSystemIpMap(publicRoot, env = process.env) {
  const out = new Map();
  const invDir = resolveRepoFile(publicRoot, "inventory/manual/systems", env);
  if (!invDir.found) return out;
  let names;
  try {
    names = readdirSync(invDir.path).filter((n) => n.endsWith(".json") && !n.startsWith("_"));
  } catch {
    return out;
  }
  for (const name of names) {
    const resolved = resolveRepoFile(publicRoot, `inventory/manual/systems/${name}`, env);
    if (!resolved.found) continue;
    try {
      const data = readResolvedRepoJson(resolved);
      const id = typeof data.id === "string" ? data.id : name.replace(/\.json$/, "");
      const ip = primaryIpFromSystem(data);
      if (ip) out.set(id, ip);
    } catch {
      // ignore
    }
  }
  return out;
}

function applyInfraExceptions(map, key, urls) {
  if (shouldSkipVaultKeyUri(key)) return;
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  for (const u of urls) {
    const n = normalizeServiceUrl(u);
    if (n) set.add(n);
  }
}

function applyHardcodedInfraUrls(publicRoot, env, map) {
  const proxmoxRoot = join(clumpsDir(publicRoot), "infrastructure", "proxmox");
  try {
    const { data } = loadClumpConfigFromClumpRoot(proxmoxRoot, {
      publicRoot,
      env,
      bootstrapFromExample: false,
    });
    const proxmoxUrls = ["https://pve.hdc.dukk.org:8006"];
    for (const cluster of Array.isArray(data.clusters) ? data.clusters : []) {
      if (!cluster || typeof cluster !== "object") continue;
      for (const h of /** @type {Record<string, unknown>} */ (cluster).hosts ?? []) {
        if (!h || typeof h !== "object") continue;
        const u = normalizeServiceUrl(
          typeof /** @type {Record<string, unknown>} */ (h).web_ui === "string"
            ? /** @type {Record<string, unknown>} */ (h).web_ui
            : null,
        );
        if (u) proxmoxUrls.push(u);
      }
    }
    for (const key of map.keys()) {
      if (/^HDC_PROXMOX_/.test(key) || key === "HDC_HOMEPAGE_PROXMOX_API_TOKEN") {
        applyInfraExceptions(map, key, proxmoxUrls);
      }
    }
    applyInfraExceptions(map, "HDC_PROXMOX_API_TOKEN", proxmoxUrls);
    applyInfraExceptions(map, "HDC_HOMEPAGE_PROXMOX_API_TOKEN", proxmoxUrls);
  } catch {
    applyInfraExceptions(map, "HDC_PROXMOX_API_TOKEN", ["https://pve.hdc.dukk.org:8006"]);
  }

  applyInfraExceptions(map, "HDC_UNIFI_NETWORK_API_KEY", ["https://unifi.hdc.dukk.org"]);
  applyInfraExceptions(map, "HDC_PIHOLE_WEBPASSWORD", [
    "http://pi-hole-a.hdc.dukk.org/admin",
    "http://pi-hole-b.hdc.dukk.org/admin",
  ]);
  applyInfraExceptions(map, "HDC_PIHOLE_API_TOKEN", [
    "http://pi-hole-a.hdc.dukk.org/admin",
    "http://pi-hole-b.hdc.dukk.org/admin",
  ]);
  applyInfraExceptions(map, "HDC_PIHOLE_API_TOKEN_A", ["http://pi-hole-a.hdc.dukk.org/admin"]);
  applyInfraExceptions(map, "HDC_PIHOLE_API_TOKEN_B", ["http://pi-hole-b.hdc.dukk.org/admin"]);
  applyInfraExceptions(map, "HDC_STEP_CA_PASSWORD", ["https://ca.hdc.dukk.org"]);
  applyInfraExceptions(map, "HDC_STEP_CA_PASSWORD_A", ["https://ca.hdc.dukk.org"]);

  try {
    const { data } = loadClumpConfigFromClumpRoot(
      join(clumpsDir(publicRoot), "services", "mailcow"),
      { publicRoot, env, bootstrapFromExample: false },
    );
    const mailcowBlock =
      data.defaults && typeof data.defaults === "object"
        ? /** @type {Record<string, unknown>} */ (data.defaults).mailcow
        : data.mailcow;
    const mc =
      mailcowBlock && typeof mailcowBlock === "object" && !Array.isArray(mailcowBlock)
        ? mailcowBlock
        : {};
    const mailcowUrls = [];
    const adminUrl = normalizeServiceUrl(typeof mc.admin_url === "string" ? mc.admin_url : null);
    const apiUrl = normalizeServiceUrl(typeof mc.api_url === "string" ? mc.api_url : null);
    if (adminUrl) mailcowUrls.push(adminUrl);
    if (apiUrl) mailcowUrls.push(apiUrl);
    applyInfraExceptions(map, "HDC_MAILCOW_API_KEY", mailcowUrls);
  } catch {
    // optional
  }
}

function scanHomepageWidgetUris(publicRoot, env, map, systemIps) {
  const hpRoot = join(clumpsDir(publicRoot), "services", "homepage");
  let data;
  try {
    data = loadClumpConfigFromClumpRoot(hpRoot, {
      publicRoot,
      env,
      bootstrapFromExample: false,
    }).data;
  } catch {
    return;
  }
  const defaults =
    data.defaults && typeof data.defaults === "object"
      ? /** @type {Record<string, unknown>} */ (data.defaults)
      : {};
  const homepageRaw = defaults.homepage ?? data.homepage;
  if (!isObject(homepageRaw)) return;
  const homepage = /** @type {Record<string, unknown>} */ (homepageRaw);

  const plexWidget = homepage.plex_widget;
  if (isObject(plexWidget)) {
    const vaultKey = vaultKeyFromWidget(plexWidget, "token_vault_key", DEFAULT_PLEX_TOKEN_VAULT_KEY);
    const url =
      typeof plexWidget.url === "string" && plexWidget.url.trim()
        ? plexWidget.url.trim().replace(/\/+$/, "")
        : "http://192.0.2.9:32400";
    setVaultKeyUris(map, vaultKey, [url]);
  }

  const haWidget = homepage.homeassistant_widget;
  if (isObject(haWidget)) {
    const vaultKey = vaultKeyFromWidget(haWidget, "token_vault_key", DEFAULT_HA_TOKEN_VAULT_KEY);
    try {
      const haRoot = join(clumpsDir(publicRoot), "services", "homeassistant");
      const haData = loadClumpConfigFromClumpRoot(haRoot, {
        publicRoot,
        env,
        bootstrapFromExample: false,
      }).data;
      const deployments = Array.isArray(haData.deployments) ? haData.deployments : [];
      const deployment = deployments.find(isObject) ?? null;
      const haDefaults = isObject(haData.defaults) ? haData.defaults : {};
      const haBlock = isObject(haDefaults.homeassistant) ? haDefaults.homeassistant : {};
      const publicUrl = typeof haBlock.public_url === "string" ? haBlock.public_url : "";
      let url = normalizeServiceUrl(publicUrl);
      if (!url && deployment) {
        const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
        const q = isObject(px.qemu) ? px.qemu : {};
        const ip = ipFromCidr(typeof q.ip === "string" ? q.ip : "");
        url = normalizeServiceUrl(serviceUrlFromHostPort(ip ?? "", 8123));
      }
      if (url) setVaultKeyUris(map, vaultKey, [url]);
    } catch {
      // optional
    }
  }

  const absWidget = homepage.audiobookshelf_widget;
  if (isObject(absWidget)) {
    const vaultKey = vaultKeyFromWidget(
      absWidget,
      "token_vault_key",
      DEFAULT_AUDIOBOOKSHELF_TOKEN_VAULT_KEY,
    );
    try {
      const absRoot = join(clumpsDir(publicRoot), "services", "audiobookshelf");
      const absData = loadClumpConfigFromClumpRoot(absRoot, {
        publicRoot,
        env,
        bootstrapFromExample: false,
      }).data;
      const absDefaults = isObject(absData.defaults) ? absData.defaults : {};
      const deployments = Array.isArray(absData.deployments)
        ? absData.deployments.filter(isObject)
        : [];
      const deployment = deployments[0];
      if (deployment) {
        const defaultAbs = isObject(absDefaults.audiobookshelf) ? absDefaults.audiobookshelf : {};
        const deployAbs = isObject(deployment.audiobookshelf) ? deployment.audiobookshelf : {};
        const merged = { ...defaultAbs, ...deployAbs };
        const portRaw =
          typeof merged.host_port === "number" ? merged.host_port : Number(merged.host_port);
        const port = Number.isFinite(portRaw) && portRaw > 0 ? Math.floor(portRaw) : 13378;
        const configure = isObject(deployment.configure) ? deployment.configure : {};
        const ssh = isObject(configure.ssh) ? configure.ssh : {};
        const host = typeof ssh.host === "string" ? ssh.host.trim() : "";
        const sid = typeof deployment.system_id === "string" ? deployment.system_id : "";
        const lanHost = host || (sid ? systemIps.get(sid) : "") || "";
        const url = serviceUrlFromHostPort(lanHost, port);
        if (url) setVaultKeyUris(map, vaultKey, [url]);
      }
    } catch {
      // optional
    }
  }

  const unifiWidget = homepage.unifi_widget;
  if (isObject(unifiWidget)) {
    const vaultKey = vaultKeyFromWidget(unifiWidget, "api_key_vault_key", UNIFI_API_KEY_VAULT_KEY);
    try {
      const unifiRoot = join(clumpsDir(publicRoot), "infrastructure", "unifi-network");
      const unifiData = loadClumpConfigFromClumpRoot(unifiRoot, {
        publicRoot,
        env,
        bootstrapFromExample: false,
      }).data;
      const controller = controllerFromPackageConfig(unifiData);
      const controllerUrl = controller?.url ? normalizeServiceUrl(controller.url) : null;
      if (controllerUrl && !controllerUrl.includes("10.0.0.1")) {
        setVaultKeyUris(map, vaultKey, [controllerUrl]);
      } else {
        applyInfraExceptions(map, vaultKey, ["https://unifi.hdc.dukk.org"]);
      }
    } catch {
      applyInfraExceptions(map, vaultKey, ["https://unifi.hdc.dukk.org"]);
    }
  }

  const crowdsecWidget = homepage.crowdsec_widget;
  if (isObject(crowdsecWidget)) {
    const vaultKey = vaultKeyFromWidget(
      crowdsecWidget,
      "token_vault_key",
      "HDC_HOMEPAGE_CROWDSEC_LAPI_PASSWORD",
    );
    try {
      const csRoot = join(clumpsDir(publicRoot), "services", "crowdsec");
      const csData = loadClumpConfigFromClumpRoot(csRoot, {
        publicRoot,
        env,
        bootstrapFromExample: false,
      }).data;
      const csDefaults = isObject(csData.defaults) ? csData.defaults : {};
      const deployments = Array.isArray(csData.deployments)
        ? csData.deployments.filter(isObject)
        : [];
      const deployment = deployments[0];
      if (deployment) {
        const csBlock = isObject(csDefaults.crowdsec) ? csDefaults.crowdsec : {};
        const portRaw = typeof csBlock.lapi_port === "number" ? csBlock.lapi_port : 8080;
        const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
        const lxc = isObject(px.lxc) ? px.lxc : {};
        const ip = ipFromIpConfig(typeof lxc.ip_config === "string" ? lxc.ip_config : "");
        const sid = typeof deployment.system_id === "string" ? deployment.system_id : "";
        const lanHost = ip || (sid ? systemIps.get(sid) : "") || "";
        const url = serviceUrlFromHostPort(lanHost, portRaw);
        if (url) setVaultKeyUris(map, vaultKey, [url]);
      }
    } catch {
      // optional
    }
  }
}

function collectVaultKeysFromNode(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectVaultKeysFromNode(item, out);
    return;
  }
  const obj = /** @type {Record<string, unknown>} */ (node);
  for (const [k, v] of Object.entries(obj)) {
    if (k.endsWith("_vault_key") && typeof v === "string" && v.startsWith("HDC_")) {
      out.add(v.trim());
    }
    collectVaultKeysFromNode(v, out);
  }
}

function scanPackageConfigs(publicRoot, env, map, systemIps) {
  for (const m of discoverManifests(clumpsDir(publicRoot))) {
    if (manifestId(m) === "homepage") {
      scanHomepageWidgetUris(publicRoot, env, map, systemIps);
      continue;
    }

    let data;
    try {
      data = loadClumpConfigFromClumpRoot(m.dir, {
        publicRoot,
        env,
        bootstrapFromExample: false,
      }).data;
    } catch {
      continue;
    }
    const defaults =
      data.defaults && typeof data.defaults === "object"
        ? /** @type {Record<string, unknown>} */ (data.defaults)
        : {};
    const defaultPackageUrls = extractDefaultPackageUrls(defaults);
    /** @type {Set<string>} */
    const packageKeys = new Set();
    walkConfigNode(data, { _packageDefaultUrls: defaultPackageUrls }, map);
    collectVaultKeysFromNode(data, packageKeys);

    const deployments = Array.isArray(data.deployments) ? data.deployments : [];
    const multiDeploy = deployments.length > 1;
    /** @type {Set<string>} */
    const depSubtreeKeys = new Set();
    for (const d of deployments) collectVaultKeysFromNode(d, depSubtreeKeys);

    for (const vaultKey of packageKeys) {
      const dep = deploymentForVaultKey(vaultKey, deployments);
      if (!dep) continue;
      const { urls, ip, hostPort, systemId } = urlsFromDeployment(dep, defaults, {
        includeDefaultUrls: !multiDeploy,
      });
      const sid = systemId || (typeof dep.system_id === "string" ? dep.system_id : "");
      const lanIp = ip || (sid ? systemIps.get(sid) : null);
      if (lanIp && hostPort) {
        const lan = urlFromHostPort(lanIp, hostPort);
        if (lan) urls.push(lan);
      }
      addVaultKeyUris(map, vaultKey, urls);
    }

    for (const d of deployments) {
      if (!d || typeof d !== "object" || Array.isArray(d)) continue;
      const dep = /** @type {Record<string, unknown>} */ (d);
      const depKeys = new Set();
      collectVaultKeysFromNode(dep, depKeys);
      if (depKeys.size === 0) continue;
      const { urls, ip, hostPort, systemId } = urlsFromDeployment(dep, defaults, {
        includeDefaultUrls: false,
      });
      const sid = systemId || (typeof dep.system_id === "string" ? dep.system_id : "");
      const lanIp = ip || (sid ? systemIps.get(sid) : null);
      if (lanIp && hostPort) {
        const lan = urlFromHostPort(lanIp, hostPort);
        if (lan) urls.push(lan);
      }
      for (const vaultKey of depKeys) {
        addVaultKeyUris(map, vaultKey, urls);
      }
    }

    if (deployments.length > 0) {
      const firstDep = deployments.find((d) => d && typeof d === "object" && !Array.isArray(d));
      if (firstDep) {
        const { ip, hostPort, systemId } = urlsFromDeployment(
          /** @type {Record<string, unknown>} */ (firstDep),
          defaults,
          { includeDefaultUrls: false },
        );
        const sid =
          systemId ||
          (typeof /** @type {Record<string, unknown>} */ (firstDep).system_id === "string"
            ? /** @type {Record<string, unknown>} */ (firstDep).system_id
            : "");
        const lanIp = ip || (sid ? systemIps.get(sid) : null);
        const lan = lanIp && hostPort ? urlFromHostPort(lanIp, hostPort) : null;
        if (lan) {
          for (const vaultKey of packageKeys) {
            if (depSubtreeKeys.has(vaultKey)) continue;
            if (deploymentForVaultKey(vaultKey, deployments)) continue;
            addVaultKeyUris(map, vaultKey, [lan]);
          }
        }
      }
    }

    if (deployments.length === 0) {
      for (const vaultKey of packageKeys) {
        const { urls, ip, hostPort } = urlsFromDeployment(defaults, defaults);
        const sid =
          typeof defaults.system_id === "string"
            ? defaults.system_id
            : typeof data.system_id === "string"
              ? data.system_id
              : "";
        const lanIp = ip || (sid ? systemIps.get(sid) : null);
        if (lanIp && hostPort) {
          const lan = urlFromHostPort(lanIp, hostPort);
          if (lan) urls.push(lan);
        }
        addVaultKeyUris(map, vaultKey, urls);
      }
    }
  }
}

export function sortVaultKeyUris(urls) {
  const unique = [...new Set(urls.map((u) => normalizeServiceUrl(u)).filter(Boolean))];
  return unique.sort((a, b) => {
    const aLan = /^https?:\/\/10\./.test(a);
    const bLan = /^https?:\/\/10\./.test(b);
    if (aLan !== bLan) return aLan ? 1 : -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

export function resolveVaultKeyUris(publicRoot, env = process.env, envKey) {
  return buildAllVaultKeyUris(publicRoot, env).get(envKey) ?? [];
}

export function buildAllVaultKeyUris(publicRoot = repoRoot(), env = process.env) {
  const map = new Map();
  const systemIps = loadSystemIpMap(publicRoot, env);
  scanPackageConfigs(publicRoot, env, map, systemIps);
  applyHardcodedInfraUrls(publicRoot, env, map);
  const nginxIndex = loadNginxWafIndex(publicRoot, env);
  const out = new Map();
  for (const [key, urlSet] of map) {
    if (shouldSkipVaultKeyUri(key)) continue;
    const sorted = sortVaultKeyUris(expandWithNginxAliases([...urlSet], nginxIndex));
    if (sorted.length > 0) out.set(key, sorted);
  }
  return out;
}

export function vaultKeyUrisEqual(live, desired) {
  const a = sortVaultKeyUris(live);
  const b = sortVaultKeyUris(desired);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
