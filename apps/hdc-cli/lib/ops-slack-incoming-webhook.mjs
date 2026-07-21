/**
 * Slack Incoming Webhook helpers for ops alerts (legacy channel: slack-incoming-webhook).
 * Prefer the Slack HDC app (ops-slack-app-notify.mjs) for interactive approve/deny.
 */
import {
  formatNotifyAttributionHeader,
  redactIpsFromText,
} from "./ops-discord-notify.mjs";

export const OPS_SLACK_WEBHOOK_KEY = "HDC_OPS_SLACK_WEBHOOK_URL";
export const AGENTS_SLACK_WEBHOOK_KEY = "HDC_AGENTS_SLACK_WEBHOOK_URL";

const MAX_TEXT = 1900;

/**
 * Plain-text Slack body: attribution header without Discord **bold**, then message.
 *
 * @param {string} title
 * @param {string} message
 * @param {{ env?: NodeJS.ProcessEnv; host?: string; system?: string; app?: string }} [opts]
 * @returns {string}
 */
export function formatSlackIncomingWebhookText(title, message, opts = {}) {
  const discordHeader = formatNotifyAttributionHeader(title.trim() || "HDC Ops", opts);
  const header = discordHeader.replace(/\*\*/g, "");
  const body = message.trim();
  const text = body ? `${header}\n\n${body}` : header;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text;
}

/** @deprecated Use formatSlackIncomingWebhookText */
export const formatSlackText = formatSlackIncomingWebhookText;

/**
 * @param {string} url
 * @param {string} text
 * @param {{ fetchFn?: typeof fetch }} [opts]
 */
export async function postSlackWebhook(url, text, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(`Slack webhook HTTP ${res.status}: ${snippet}`);
  }
}

/**
 * Resolve Slack webhook: OPS key first, then AGENTS (one channel can share AGENTS only).
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @param {string} [opts.webhookVaultKey]
 * @param {string} [opts.fallbackWebhookVaultKey]
 * @returns {Promise<string | null>}
 */
export async function resolveOpsSlackWebhookUrl(opts = {}) {
  const env = opts.env ?? process.env;
  const key =
    typeof opts.webhookVaultKey === "string" && opts.webhookVaultKey.trim()
      ? opts.webhookVaultKey.trim()
      : OPS_SLACK_WEBHOOK_KEY;
  const fromEnv = String(env[key] ?? "").trim();
  if (fromEnv) return fromEnv;
  if (opts.getSecret) {
    const fromVault = await opts.getSecret(key, { optional: true });
    const trimmed = String(fromVault ?? "").trim();
    if (trimmed) return trimmed;
  }
  const fallback =
    typeof opts.fallbackWebhookVaultKey === "string"
      ? opts.fallbackWebhookVaultKey.trim()
      : key === OPS_SLACK_WEBHOOK_KEY
        ? AGENTS_SLACK_WEBHOOK_KEY
        : "";
  if (fallback && fallback !== key) {
    return resolveOpsSlackWebhookUrl({
      env,
      getSecret: opts.getSecret,
      webhookVaultKey: fallback,
      fallbackWebhookVaultKey: "",
    });
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.message]
 * @param {string} [opts.content] Preformatted text (skips formatSlackIncomingWebhookText)
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @param {string} [opts.webhookVaultKey]
 * @param {string} [opts.fallbackWebhookVaultKey]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ ok: true; mode: "slack-incoming-webhook" } | { ok: false; skipped?: boolean; error?: string }>}
 */
export async function sendOpsSlackIncomingWebhookMessage(opts) {
  const env = opts.env ?? process.env;
  let text = typeof opts.content === "string" ? opts.content.trim() : "";
  if (!text) {
    const title = String(opts.title ?? "").trim();
    const message = redactIpsFromText(String(opts.message ?? "").trim());
    if (!title && !message) return { ok: false, skipped: true };
    text = formatSlackIncomingWebhookText(title || "HDC Ops", message, { env });
  }
  const url = await resolveOpsSlackWebhookUrl({
    env,
    getSecret: opts.getSecret,
    webhookVaultKey: opts.webhookVaultKey,
    fallbackWebhookVaultKey: opts.fallbackWebhookVaultKey,
  });
  if (!url) return { ok: false, skipped: true, error: "slack webhook not configured" };
  try {
    await postSlackWebhook(url, text, { fetchFn: opts.fetchFn });
    return { ok: true, mode: "slack-incoming-webhook" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** @deprecated Use sendOpsSlackIncomingWebhookMessage */
export const sendOpsSlackMessage = sendOpsSlackIncomingWebhookMessage;
