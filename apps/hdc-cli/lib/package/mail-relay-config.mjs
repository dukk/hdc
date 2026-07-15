import { join } from "node:path";

import { loadClumpConfigFromClumpRoot } from "./clump-run-config.mjs";
import { repoRoot } from "../../paths.mjs";

/** @typedef {object} MailRelayClientDefaults
 * @property {string} relayhost Bracketed host for Postfix relayhost, e.g. [192.0.2.60]
 * @property {string} relay_hostname DNS name for app SMTP clients
 * @property {number} relay_port SMTP port on internal relay (default 25)
 * @property {string} myorigin Default envelope origin domain
 * @property {string} default_from Default From address for apps
 * @property {string} inet_interfaces Postfix inet_interfaces on satellite hosts
 * @property {string} relay_system_id System id of the relay host (skip satellite on this guest)
 */

const FALLBACK_DEFAULTS = {
  relayhost: "[192.0.2.60]",
  relay_hostname: "postfix-relay.home.example.invalid",
  relay_port: 25,
  myorigin: "hdc.example.invalid",
  default_from: "noreply@hdc.example.invalid",
  inet_interfaces: "loopback-only",
  relay_system_id: "postfix-relay-a",
};

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} raw
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {MailRelayClientDefaults}
 */
export function normalizeClientDefaults(raw, env = process.env) {
  const relayHostEnv =
    typeof env.HDC_MAIL_RELAY_HOST === "string" && env.HDC_MAIL_RELAY_HOST.trim()
      ? env.HDC_MAIL_RELAY_HOST.trim()
      : "";
  const relayhost =
    relayHostEnv !== ""
      ? relayHostEnv.startsWith("[")
        ? relayHostEnv
        : `[${relayHostEnv}]`
      : typeof raw.relayhost === "string" && raw.relayhost.trim()
        ? raw.relayhost.trim()
        : FALLBACK_DEFAULTS.relayhost;

  const relayHostname =
    typeof raw.relay_hostname === "string" && raw.relay_hostname.trim()
      ? raw.relay_hostname.trim()
      : FALLBACK_DEFAULTS.relay_hostname;

  const relayPortRaw = raw.relay_port;
  const relay_port =
    typeof relayPortRaw === "number" && Number.isFinite(relayPortRaw) && relayPortRaw > 0
      ? Math.round(relayPortRaw)
      : FALLBACK_DEFAULTS.relay_port;

  return {
    relayhost,
    relay_hostname: relayHostname,
    relay_port,
    myorigin:
      typeof raw.myorigin === "string" && raw.myorigin.trim()
        ? raw.myorigin.trim()
        : FALLBACK_DEFAULTS.myorigin,
    default_from:
      typeof raw.default_from === "string" && raw.default_from.trim()
        ? raw.default_from.trim()
        : FALLBACK_DEFAULTS.default_from,
    inet_interfaces:
      typeof raw.inet_interfaces === "string" && raw.inet_interfaces.trim()
        ? raw.inet_interfaces.trim()
        : FALLBACK_DEFAULTS.inet_interfaces,
    relay_system_id:
      typeof raw.relay_system_id === "string" && raw.relay_system_id.trim()
        ? raw.relay_system_id.trim()
        : FALLBACK_DEFAULTS.relay_system_id,
  };
}

let _cachedDefaults = /** @type {MailRelayClientDefaults | null} */ (null);

/**
 * Load client_defaults from clumps/services/postfix-relay/config.json (hdc-private first).
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {boolean} [opts.refresh]
 * @returns {MailRelayClientDefaults}
 */
export function loadMailRelayClientDefaults(opts = {}) {
  if (_cachedDefaults && !opts.refresh) return _cachedDefaults;

  const env = opts.env ?? process.env;
  const root = repoRoot();
  const clumpRoot = join(root, "clumps", "services", "postfix-relay");

  /** @type {Record<string, unknown>} */
  let clientRaw = {};
  /** @type {Record<string, unknown>} */
  let deployRaw = {};

  try {
    const loaded = loadClumpConfigFromClumpRoot(clumpRoot, {
      exampleRel: "clumps/services/postfix-relay/config.example.json",
    });
    const data = loaded.data;
    if (isObject(data.client_defaults)) {
      clientRaw = /** @type {Record<string, unknown>} */ (data.client_defaults);
    }
    if (isObject(data.deploy)) {
      deployRaw = /** @type {Record<string, unknown>} */ (data.deploy);
    }
  } catch {
    /* use fallbacks */
  }

  const merged = { ...clientRaw };
  if (!merged.relay_system_id && deployRaw.system_id) {
    merged.relay_system_id = deployRaw.system_id;
  }

  _cachedDefaults = normalizeClientDefaults(merged, env);
  return _cachedDefaults;
}

/** Reset cached defaults (tests). */
export function resetMailRelayClientDefaultsCache() {
  _cachedDefaults = null;
}

/**
 * Resolve myhostname for a satellite host from deployment facts.
 * @param {Record<string, unknown> | undefined} deployment
 * @param {string} myorigin
 * @returns {string}
 */
export function resolveSatelliteMyhostname(deployment, myorigin) {
  const d = deployment && isObject(deployment) ? deployment : {};
  const hostname =
    typeof d.hostname === "string" && d.hostname.trim()
      ? d.hostname.trim()
      : typeof d.system_id === "string" && d.system_id.trim()
        ? d.system_id.trim()
        : typeof d.systemId === "string" && d.systemId.trim()
          ? d.systemId.trim()
          : "localhost";

  if (hostname.includes(".")) return hostname;
  if (myorigin) return `${hostname}.${myorigin}`;
  return hostname;
}
