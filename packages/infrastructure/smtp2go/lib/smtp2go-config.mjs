import { SMTP2GO_API_KEY_VAULT_KEY } from "./vault-deps.mjs";

/**
 * @typedef {{
 *   id: string;
 *   domain: string;
 *   managed: boolean;
 *   tracking_subdomain: string | null;
 *   returnpath_subdomain: string | null;
 *   notes: string | null;
 *   dmarc: string | null;
 *   spf: string | null;
 *   spf_variant: "default" | "mailcow" | null;
 * }} ConfigSenderDomain
 */

/**
 * @param {unknown} v
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} value
 */
export function slugifyId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * @param {string} fqdn
 */
export function domainIdFromFqdn(fqdn) {
  return slugifyId(fqdn.replace(/\./g, "-"));
}

/**
 * @param {import('./smtp2go-api.mjs').Smtp2goSenderDomainRow} row
 * @param {ConfigSenderDomain | null} [existing]
 */
export function liveDomainToConfig(row, existing = null) {
  const fulldomain =
    typeof row.domain?.fulldomain === "string" ? row.domain.fulldomain.trim() : "";
  const tracker = Array.isArray(row.trackers) ? row.trackers.find((t) => t.enabled !== false) : null;
  const trackingSub =
    tracker && typeof tracker.subdomain === "string" ? tracker.subdomain.trim() || null : null;
  const rpath =
    typeof row.domain?.rpath_selector === "string" ? row.domain.rpath_selector.trim() || null : null;

  return /** @type {ConfigSenderDomain} */ ({
    id: existing?.id || domainIdFromFqdn(fulldomain),
    domain: fulldomain,
    managed: existing?.managed ?? false,
    tracking_subdomain: trackingSub ?? existing?.tracking_subdomain ?? null,
    returnpath_subdomain: rpath ?? existing?.returnpath_subdomain ?? null,
    notes: existing?.notes ?? null,
    dmarc: existing?.dmarc ?? null,
    spf: existing?.spf ?? null,
    spf_variant: existing?.spf_variant ?? null,
  });
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function normalizeSmtp2goConfig(cfg) {
  const sg = isObject(cfg.smtp2go) ? cfg.smtp2go : {};
  const auth = isObject(sg.auth) ? sg.auth : {};
  const apiKeyVaultKey =
    typeof auth.api_key_vault_key === "string" && auth.api_key_vault_key.trim()
      ? auth.api_key_vault_key.trim()
      : SMTP2GO_API_KEY_VAULT_KEY;

  const apiBase =
    typeof sg.api_base_url === "string" && sg.api_base_url.trim()
      ? sg.api_base_url.trim().replace(/\/$/, "")
      : "https://api.smtp2go.com/v3";

  const defaultsRaw = isObject(cfg.defaults) ? cfg.defaults : {};
  const trackingDefault =
    typeof defaultsRaw.tracking_subdomain === "string" &&
    defaultsRaw.tracking_subdomain.trim()
      ? defaultsRaw.tracking_subdomain.trim()
      : "link";
  const returnpathDefault =
    typeof defaultsRaw.returnpath_subdomain === "string" &&
    defaultsRaw.returnpath_subdomain.trim()
      ? defaultsRaw.returnpath_subdomain.trim()
      : null;
  const autoVerify = defaultsRaw.auto_verify === true;

  /** @type {ConfigSenderDomain[]} */
  const senderDomains = [];
  const list = Array.isArray(cfg.sender_domains) ? cfg.sender_domains : [];
  for (const raw of list) {
    if (!isObject(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const domain = typeof raw.domain === "string" ? raw.domain.trim().toLowerCase() : "";
    if (!id || !domain) continue;

    const spfVariant =
      raw.spf_variant === "mailcow" ? "mailcow" : raw.spf_variant === "default" ? "default" : null;

    senderDomains.push({
      id,
      domain,
      managed: raw.managed === true,
      tracking_subdomain:
        typeof raw.tracking_subdomain === "string" && raw.tracking_subdomain.trim()
          ? raw.tracking_subdomain.trim()
          : null,
      returnpath_subdomain:
        typeof raw.returnpath_subdomain === "string" && raw.returnpath_subdomain.trim()
          ? raw.returnpath_subdomain.trim()
          : null,
      notes: typeof raw.notes === "string" ? raw.notes.trim() || null : null,
      dmarc: typeof raw.dmarc === "string" ? raw.dmarc.trim() || null : null,
      spf: typeof raw.spf === "string" ? raw.spf.trim() || null : null,
      spf_variant: spfVariant,
    });
  }

  const domainsById = new Map(senderDomains.map((d) => [d.id, d]));
  const domainsByFqdn = new Map(senderDomains.map((d) => [d.domain, d]));

  return {
    apiBase,
    apiKeyVaultKey,
    defaults: {
      tracking_subdomain: trackingDefault,
      returnpath_subdomain: returnpathDefault,
      auto_verify: autoVerify,
    },
    senderDomains,
    domainsById,
    domainsByFqdn,
  };
}

/**
 * @param {ConfigSenderDomain} entry
 * @param {import('./smtp2go-api.mjs').Smtp2goSenderDomainRow | null} live
 */
export function domainPresenceDrift(entry, live) {
  if (!live) return { missing_in_live: true, extra_in_config: false };
  return { missing_in_live: false, extra_in_config: false };
}

/**
 * @param {ConfigSenderDomain} entry
 * @param {import('./smtp2go-api.mjs').Smtp2goSenderDomainRow} live
 */
export function domainSettingsDrift(entry, live) {
  const tracker = Array.isArray(live.trackers)
    ? live.trackers.find((t) => t.enabled !== false)
    : null;
  const liveTracking =
    tracker && typeof tracker.subdomain === "string" ? tracker.subdomain.trim() : null;
  const configTracking = entry.tracking_subdomain;
  if (configTracking && liveTracking && configTracking !== liveTracking) {
    return true;
  }
  const liveRpath =
    typeof live.domain?.rpath_selector === "string" ? live.domain.rpath_selector.trim() : null;
  const configRpath = entry.returnpath_subdomain;
  if (configRpath && liveRpath && configRpath !== liveRpath) {
    return true;
  }
  return false;
}

/**
 * Resolve tracking/returnpath for domain/add from config entry + defaults.
 * @param {ConfigSenderDomain} entry
 * @param {ReturnType<typeof normalizeSmtp2goConfig>["defaults"]} defaults
 */
export function resolveDomainAddOptions(entry, defaults) {
  return {
    trackingSubdomain: entry.tracking_subdomain ?? defaults.tracking_subdomain,
    returnpathSubdomain: entry.returnpath_subdomain ?? defaults.returnpath_subdomain ?? undefined,
    autoVerify: defaults.auto_verify,
  };
}
