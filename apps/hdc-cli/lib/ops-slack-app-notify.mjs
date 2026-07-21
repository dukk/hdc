/**
 * Slack HDC app notifications via Bot API (chat.postMessage + Block Kit buttons).
 */
import {
  formatNotifyAttributionHeader,
  redactIpsFromText,
} from "./ops-discord-notify.mjs";

export const SLACK_BOT_TOKEN_KEY = "HDC_SLACK_BOT_TOKEN";
export const SLACK_DECISION_CHANNEL_ENV = "HDC_SLACK_DECISION_CHANNEL";
export const SLACK_API_BASE = "https://slack.com/api";

const MAX_TEXT = 3000;

/**
 * @param {string} title
 * @param {string} message
 * @param {{ env?: NodeJS.ProcessEnv; host?: string; system?: string; app?: string }} [opts]
 * @returns {string}
 */
export function formatSlackAppText(title, message, opts = {}) {
  const discordHeader = formatNotifyAttributionHeader(title.trim() || "HDC Ops", opts);
  const header = discordHeader.replace(/\*\*/g, "");
  const body = message.trim();
  const text = body ? `${header}\n\n${body}` : header;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text;
}

/**
 * Block Kit Approve/Deny buttons (action_id matches Discord custom_id pattern).
 *
 * @param {string} taskId
 * @returns {unknown[]}
 */
export function buildSlackDecisionBlocks(taskId) {
  const id = String(taskId ?? "").trim();
  if (!id) return [];
  return [
    {
      type: "actions",
      block_id: `hdc_decision_${id}`.slice(0, 255),
      elements: [
        {
          type: "button",
          action_id: `hdc:approve:${id}`,
          text: { type: "plain_text", text: "Approve", emoji: true },
          style: "primary",
          value: id,
        },
        {
          type: "button",
          action_id: `hdc:deny:${id}`,
          text: { type: "plain_text", text: "Deny", emoji: true },
          style: "danger",
          value: id,
        },
      ],
    },
  ];
}

/**
 * @param {string} customIdOrActionId
 * @returns {{ action: "approve" | "deny"; taskId: string } | null}
 */
export function parseSlackDecisionActionId(customIdOrActionId) {
  const s = String(customIdOrActionId ?? "").trim();
  const m = s.match(/^hdc:(approve|deny):([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  if (!m) return null;
  return {
    action: /** @type {"approve" | "deny"} */ (m[1]),
    taskId: m[2],
  };
}

/**
 * @param {object} opts
 * @param {string} opts.botToken
 * @param {string} opts.channel
 * @param {string} opts.text
 * @param {unknown[]} [opts.blocks]
 * @param {string} [opts.thread_ts]
 * @param {string} [opts.apiBase]
 * @param {typeof fetch} [opts.fetchFn]
 */
export async function postSlackChatMessage(opts) {
  const fetchFn = opts.fetchFn ?? fetch;
  const apiBase = (opts.apiBase || SLACK_API_BASE).replace(/\/$/, "");
  const botToken = String(opts.botToken ?? "").trim();
  const channel = String(opts.channel ?? "").trim();
  if (!botToken) throw new Error("botToken is required");
  if (!channel) throw new Error("channel is required");

  /** @type {Record<string, unknown>} */
  const payload = {
    channel,
    text: opts.text,
  };
  if (Array.isArray(opts.blocks) && opts.blocks.length) {
    payload.blocks = opts.blocks;
  }
  const threadTs = String(opts.thread_ts ?? "").trim();
  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const res = await fetchFn(`${apiBase}/chat.postMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const err = typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
    throw new Error(`Slack chat.postMessage failed: ${err}`);
  }
  return data;
}

/**
 * Resolve bot token from env or vault.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @param {string} [opts.botTokenVaultKey]
 * @returns {Promise<string | null>}
 */
export async function resolveSlackBotToken(opts = {}) {
  const env = opts.env ?? process.env;
  const key =
    typeof opts.botTokenVaultKey === "string" && opts.botTokenVaultKey.trim()
      ? opts.botTokenVaultKey.trim()
      : SLACK_BOT_TOKEN_KEY;
  const fromEnv = String(env[key] ?? "").trim();
  if (fromEnv) return fromEnv;
  if (opts.getSecret) {
    const fromVault = await opts.getSecret(key, { optional: true });
    const trimmed = String(fromVault ?? "").trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Strip leading # and whitespace from a Slack channel ref.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSlackChannelRef(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^#/, "")
    .trim();
}

/**
 * True when value looks like a Slack conversation id (C… / G… / D…).
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isSlackChannelId(value) {
  return /^[CGD][A-Z0-9]+$/i.test(String(value ?? "").trim());
}

/**
 * Resolve a channel name to an id via conversations.list (needs channels:read).
 *
 * @param {object} opts
 * @param {string} opts.botToken
 * @param {string} opts.name Channel name without #
 * @param {string} [opts.apiBase]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<string | null>}
 */
export async function resolveSlackChannelNameToId(opts) {
  const fetchFn = opts.fetchFn ?? fetch;
  const apiBase = (opts.apiBase || SLACK_API_BASE).replace(/\/$/, "");
  const botToken = String(opts.botToken ?? "").trim();
  const name = normalizeSlackChannelRef(opts.name).toLowerCase();
  if (!botToken || !name) return null;
  if (isSlackChannelId(name)) return name;

  let cursor = "";
  do {
    const url = new URL(`${apiBase}/conversations.list`);
    url.searchParams.set("types", "public_channel,private_channel");
    url.searchParams.set("limit", "200");
    url.searchParams.set("exclude_archived", "true");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetchFn(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      const err = typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
      throw new Error(`Slack conversations.list failed: ${err}`);
    }
    for (const ch of Array.isArray(data.channels) ? data.channels : []) {
      if (String(ch?.name ?? "").toLowerCase() === name && ch?.id) {
        return String(ch.id).trim();
      }
    }
    cursor = String(data?.response_metadata?.next_cursor ?? "").trim();
  } while (cursor);

  return null;
}

/**
 * Normalize a channel ref; resolve #name / name to C… when needed.
 *
 * @param {object} opts
 * @param {string} opts.channel
 * @param {string} opts.botToken
 * @param {string} [opts.apiBase]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<string>}
 */
export async function resolveSlackChannelForPost(opts) {
  const normalized = normalizeSlackChannelRef(opts.channel);
  if (!normalized) {
    throw new Error("slack channel is empty");
  }
  if (isSlackChannelId(normalized)) return normalized;
  const id = await resolveSlackChannelNameToId({
    botToken: opts.botToken,
    name: normalized,
    apiBase: opts.apiBase,
    fetchFn: opts.fetchFn,
  });
  if (id) return id;
  throw new Error(
    `Slack channel not found for name "${normalized}" (set HDC_SLACK_DECISION_CHANNEL to a C… id, or grant channels:read and reinstall the app)`,
  );
}

/**
 * Resolve target channel id (C… / G… / #name) from config, env, or vault.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @param {string} [opts.channelId]
 * @param {string} [opts.channelEnv]
 * @returns {Promise<string | null>}
 */
export async function resolveSlackDecisionChannel(opts = {}) {
  const explicit = String(opts.channelId ?? "").trim();
  if (explicit) return explicit;
  const env = opts.env ?? process.env;
  const envKey =
    typeof opts.channelEnv === "string" && opts.channelEnv.trim()
      ? opts.channelEnv.trim()
      : SLACK_DECISION_CHANNEL_ENV;
  const fromEnv = String(env[envKey] ?? "").trim();
  if (fromEnv) return fromEnv;
  if (opts.getSecret) {
    const fromVault = await opts.getSecret(envKey, { optional: true });
    const trimmed = String(fromVault ?? "").trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.message]
 * @param {string} [opts.content] Preformatted text
 * @param {boolean} [opts.decision]
 * @param {string} [opts.taskId]
 * @param {string} [opts.publicUrl]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @param {string} [opts.botTokenVaultKey]
 * @param {string} [opts.channelId]
 * @param {string} [opts.channelEnv]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ ok: true; mode: "slack-hdc-app" } | { ok: false; skipped?: boolean; error?: string }>}
 */
export async function sendOpsSlackAppMessage(opts) {
  const env = opts.env ?? process.env;
  const decision = opts.decision === true;
  const taskId = String(opts.taskId ?? "").trim();
  if (decision && !taskId) {
    return { ok: false, error: "taskId is required when decision is true" };
  }

  let text = typeof opts.content === "string" ? opts.content.trim() : "";
  if (!text) {
    const title = String(opts.title ?? "").trim();
    const message = redactIpsFromText(String(opts.message ?? "").trim());
    if (!title && !message) return { ok: false, skipped: true };
    text = formatSlackAppText(title || "HDC Ops", message, { env });
  }

  if (decision && taskId) {
    const publicUrl = String(opts.publicUrl ?? "").trim().replace(/\/+$/, "");
    const footer = [
      "",
      `Task ID: ${taskId}`,
      publicUrl ? `Tasks UI: ${publicUrl}/tasks` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (footer) text = `${text}\n${footer}`;
  }

  const botToken = await resolveSlackBotToken({
    env,
    getSecret: opts.getSecret,
    botTokenVaultKey: opts.botTokenVaultKey,
  });
  if (!botToken) {
    return { ok: false, skipped: true, error: "slack bot token not configured" };
  }

  const channelRaw = await resolveSlackDecisionChannel({
    env,
    getSecret: opts.getSecret,
    channelId: opts.channelId,
    channelEnv: opts.channelEnv,
  });
  if (!channelRaw) {
    return { ok: false, skipped: true, error: "slack decision channel not configured" };
  }

  /** @type {unknown[]} */
  const blocks = [];
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: text.slice(0, 2900) },
  });
  if (decision && taskId) {
    blocks.push(...buildSlackDecisionBlocks(taskId));
  }

  try {
    const channel = await resolveSlackChannelForPost({
      channel: channelRaw,
      botToken,
      fetchFn: opts.fetchFn,
    });
    await postSlackChatMessage({
      botToken,
      channel,
      text,
      blocks,
      fetchFn: opts.fetchFn,
    });
    return { ok: true, mode: "slack-hdc-app" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
