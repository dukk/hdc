import { loadMailRelayClientDefaults } from "./mail-relay-config.mjs";

/**
 * SMTP settings for application packages (no auth — internal relay trusts LAN).
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ host: string; port: number; from: string; encryption: null; myorigin: string }}
 */
export function loadMailRelayAppSettings(opts = {}) {
  const d = loadMailRelayClientDefaults({ env: opts.env });
  return {
    host: d.relay_hostname,
    port: d.relay_port,
    from: d.default_from,
    encryption: null,
    myorigin: d.myorigin,
  };
}

/**
 * @param {unknown} mailBlock
 * @returns {boolean}
 */
export function mailEnabledFromConfig(mailBlock) {
  if (mailBlock === null || typeof mailBlock !== "object" || Array.isArray(mailBlock)) {
    return false;
  }
  const m = /** @type {Record<string, unknown>} */ (mailBlock);
  return m.enabled === true || m.enabled === 1 || m.enabled === "true";
}

/**
 * Resolve recipient/from overrides from a service mail config block.
 * @param {unknown} mailBlock
 * @param {{ from: string }} defaults
 * @returns {{ to: string; from: string } | null}
 */
export function resolveMailRecipients(mailBlock, defaults) {
  if (!mailEnabledFromConfig(mailBlock)) return null;
  const m = /** @type {Record<string, unknown>} */ (mailBlock);
  const to = typeof m.to === "string" && m.to.trim() ? m.to.trim() : "";
  if (!to) return null;
  const from =
    typeof m.from === "string" && m.from.trim() ? m.from.trim() : defaults.from;
  return { to, from };
}
