/**
 * Load and normalize hdc-agents manager notification routes/channels.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stderr } from "node:process";

import {
  AGENTS_DISCORD_WEBHOOK_KEY,
  OPS_DISCORD_WEBHOOK_KEY,
} from "./ops-discord-notify.mjs";

/** @typedef {"needs_decision" | "mailbox_received" | "mailbox_spoof" | "mailbox_task_update"} ManagerRouteKey */

export const MANAGER_ROUTE_KEYS = /** @type {const} */ ([
  "needs_decision",
  "mailbox_received",
  "mailbox_spoof",
  "mailbox_task_update",
]);

/**
 * @typedef {"discord" | "email" | "slack-incoming-webhook" | "slack-hdc-app" | "teams" | "telegram"} NotifyChannelId
 */

export const NOTIFY_CHANNEL_IDS = /** @type {const} */ ([
  "discord",
  "email",
  "slack-incoming-webhook",
  "slack-hdc-app",
  "teams",
  "telegram",
]);

/** Legacy channel id accepted in configs; normalized to slack-incoming-webhook. */
export const LEGACY_SLACK_CHANNEL_ID = "slack";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Map legacy "slack" → "slack-incoming-webhook".
 *
 * @param {string} id
 * @param {{ warn?: boolean }} [opts]
 * @returns {NotifyChannelId | null}
 */
export function normalizeNotifyChannelId(id, opts = {}) {
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  if (raw === LEGACY_SLACK_CHANNEL_ID) {
    if (opts.warn !== false) {
      stderr.write(
        "notifications: channel id \"slack\" is deprecated; use \"slack-incoming-webhook\" (or \"slack-hdc-app\" for the bot app)\n",
      );
    }
    return "slack-incoming-webhook";
  }
  if (NOTIFY_CHANNEL_IDS.includes(/** @type {NotifyChannelId} */ (raw))) {
    return /** @type {NotifyChannelId} */ (raw);
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {NotifyChannelId[]}
 */
function parseRouteChannels(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {NotifyChannelId[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const item of raw) {
    const id = normalizeNotifyChannelId(String(item ?? "").trim());
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Build normalized notifications config from hdc_agents object.
 *
 * @param {Record<string, unknown>} [hdcAgents]
 * @returns {{
 *   channels: Record<string, Record<string, unknown>>,
 *   routes: Record<ManagerRouteKey, NotifyChannelId[]>,
 *   public_url: string,
 * }}
 */
export function normalizeNotificationsConfig(hdcAgents = {}) {
  const mail = isObject(hdcAgents.mail) ? hdcAgents.mail : {};
  const discord = isObject(hdcAgents.discord) ? hdcAgents.discord : {};
  const notifications = isObject(hdcAgents.notifications) ? hdcAgents.notifications : {};
  const channelsRaw = isObject(notifications.channels) ? notifications.channels : {};
  const routesRaw = isObject(notifications.routes) ? notifications.routes : {};

  const mailTo = typeof mail.to === "string" ? mail.to.trim() : "";
  const mailFrom = typeof mail.from === "string" ? mail.from.trim() : "";
  const subjectPrefix =
    typeof mail.subject_prefix === "string" && mail.subject_prefix.trim()
      ? mail.subject_prefix.trim()
      : "[HDC]";

  const emailChannel = isObject(channelsRaw.email) ? channelsRaw.email : {};
  const discordChannel = isObject(channelsRaw.discord) ? channelsRaw.discord : {};
  // Prefer new key; accept legacy "slack" channel object.
  const slackIncomingRaw = isObject(channelsRaw["slack-incoming-webhook"])
    ? channelsRaw["slack-incoming-webhook"]
    : isObject(channelsRaw.slack)
      ? channelsRaw.slack
      : {};
  if (isObject(channelsRaw.slack) && !isObject(channelsRaw["slack-incoming-webhook"])) {
    stderr.write(
      "notifications: channels.slack is deprecated; rename to channels.slack-incoming-webhook\n",
    );
  }
  const slackAppChannel = isObject(channelsRaw["slack-hdc-app"])
    ? channelsRaw["slack-hdc-app"]
    : {};
  const teamsChannel = isObject(channelsRaw.teams) ? channelsRaw.teams : {};
  const telegramChannel = isObject(channelsRaw.telegram) ? channelsRaw.telegram : {};

  const agentsWebhookKey =
    typeof discord.webhook_vault_key === "string" && discord.webhook_vault_key.trim()
      ? discord.webhook_vault_key.trim()
      : typeof discordChannel.webhook_vault_key === "string" &&
          discordChannel.webhook_vault_key.trim()
        ? discordChannel.webhook_vault_key.trim()
        : AGENTS_DISCORD_WEBHOOK_KEY;

  /** @type {Record<string, Record<string, unknown>>} */
  const channels = {
    email: {
      enabled: emailChannel.enabled !== false && mail.enabled !== false,
      to:
        typeof emailChannel.to === "string" && emailChannel.to.trim()
          ? emailChannel.to.trim()
          : mailTo,
      from:
        typeof emailChannel.from === "string" && emailChannel.from.trim()
          ? emailChannel.from.trim()
          : mailFrom,
      subject_prefix:
        typeof emailChannel.subject_prefix === "string" && emailChannel.subject_prefix.trim()
          ? emailChannel.subject_prefix.trim()
          : subjectPrefix,
    },
    discord: {
      enabled: discordChannel.enabled !== false && discord.enabled !== false,
      webhook_vault_key:
        typeof discordChannel.webhook_vault_key === "string" &&
        discordChannel.webhook_vault_key.trim()
          ? discordChannel.webhook_vault_key.trim()
          : agentsWebhookKey,
      fallback_webhook_vault_key:
        typeof discordChannel.fallback_webhook_vault_key === "string" &&
        discordChannel.fallback_webhook_vault_key.trim()
          ? discordChannel.fallback_webhook_vault_key.trim()
          : OPS_DISCORD_WEBHOOK_KEY,
      application_id:
        typeof discordChannel.application_id === "string"
          ? discordChannel.application_id.trim()
          : typeof discord.application_id === "string"
            ? discord.application_id.trim()
            : "",
      public_key:
        typeof discordChannel.public_key === "string"
          ? discordChannel.public_key.trim()
          : typeof discord.public_key === "string"
            ? discord.public_key.trim()
            : "",
      bot_token_vault_key:
        typeof discordChannel.bot_token_vault_key === "string" &&
        discordChannel.bot_token_vault_key.trim()
          ? discordChannel.bot_token_vault_key.trim()
          : typeof discord.bot_token_vault_key === "string" && discord.bot_token_vault_key.trim()
            ? discord.bot_token_vault_key.trim()
            : "HDC_OPS_DISCORD_BOT_TOKEN",
      channel_id:
        typeof discordChannel.channel_id === "string"
          ? discordChannel.channel_id.trim()
          : typeof discord.channel_id === "string"
            ? discord.channel_id.trim()
            : "",
    },
    "slack-incoming-webhook": {
      enabled: slackIncomingRaw.enabled === true,
      webhook_vault_key:
        typeof slackIncomingRaw.webhook_vault_key === "string" &&
        slackIncomingRaw.webhook_vault_key.trim()
          ? slackIncomingRaw.webhook_vault_key.trim()
          : "HDC_AGENTS_SLACK_WEBHOOK_URL",
    },
    "slack-hdc-app": {
      enabled: slackAppChannel.enabled === true,
      bot_token_vault_key:
        typeof slackAppChannel.bot_token_vault_key === "string" &&
        slackAppChannel.bot_token_vault_key.trim()
          ? slackAppChannel.bot_token_vault_key.trim()
          : "HDC_SLACK_BOT_TOKEN",
      channel_id:
        typeof slackAppChannel.channel_id === "string"
          ? slackAppChannel.channel_id.trim()
          : "",
      channel_env:
        typeof slackAppChannel.channel_env === "string" && slackAppChannel.channel_env.trim()
          ? slackAppChannel.channel_env.trim()
          : "HDC_SLACK_DECISION_CHANNEL",
      decision_authorized_users: Array.isArray(slackAppChannel.decision_authorized_users)
        ? slackAppChannel.decision_authorized_users
            .map((u) => String(u ?? "").trim())
            .filter(Boolean)
        : [],
    },
    teams: {
      enabled: teamsChannel.enabled === true,
      webhook_vault_key:
        typeof teamsChannel.webhook_vault_key === "string" &&
        teamsChannel.webhook_vault_key.trim()
          ? teamsChannel.webhook_vault_key.trim()
          : "HDC_AGENTS_TEAMS_WEBHOOK_URL",
    },
    telegram: {
      enabled: telegramChannel.enabled === true,
      bot_token_vault_key:
        typeof telegramChannel.bot_token_vault_key === "string" &&
        telegramChannel.bot_token_vault_key.trim()
          ? telegramChannel.bot_token_vault_key.trim()
          : "HDC_AGENTS_TELEGRAM_BOT_TOKEN",
      chat_id:
        typeof telegramChannel.chat_id === "string" ? telegramChannel.chat_id.trim() : "",
    },
  };

  const publicUrl =
    typeof hdcAgents.public_url === "string" && hdcAgents.public_url.trim()
      ? hdcAgents.public_url.trim().replace(/\/+$/, "")
      : "";

  /** @type {Record<ManagerRouteKey, NotifyChannelId[]>} */
  const routes = {
    needs_decision: ["discord"],
    mailbox_received: ["discord"],
    mailbox_spoof: ["discord"],
    mailbox_task_update: ["discord"],
  };

  for (const key of MANAGER_ROUTE_KEYS) {
    const parsed = parseRouteChannels(routesRaw[key]);
    if (parsed.length) routes[key] = parsed;
  }

  return { channels, routes, public_url: publicUrl };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {ReturnType<typeof normalizeNotificationsConfig>}
 */
export function parseNotificationsJson(raw) {
  if (!isObject(raw)) return normalizeNotificationsConfig();
  const channels = isObject(raw.channels) ? raw.channels : {};
  const routesRaw = isObject(raw.routes) ? raw.routes : {};
  const base = normalizeNotificationsConfig({
    notifications: { channels, routes: routesRaw },
    public_url: raw.public_url,
  });
  return base;
}

/**
 * @param {string} hdcRoot
 * @param {string} privateRoot
 * @returns {ReturnType<typeof normalizeNotificationsConfig>}
 */
export function loadNotificationsConfigFromFiles(hdcRoot, privateRoot) {
  const metaRoot = String(
    process.env.HDC_AGENTS_META_ROOT || "/opt/hdc-agents-meta",
  ).trim();
  const metaPath = join(metaRoot || "/opt/hdc-agents-meta", "notifications.json");
  if (existsSync(metaPath)) {
    try {
      return parseNotificationsJson(JSON.parse(readFileSync(metaPath, "utf8")));
    } catch {
      /* fall through */
    }
  }

  for (const p of [
    join(privateRoot, "clumps", "services", "hdc-agents", "config.json"),
    join(hdcRoot, "clumps", "services", "hdc-agents", "config.json"),
  ]) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const agents = raw?.defaults?.hdc_agents ?? raw?.hdc_agents;
      if (isObject(agents)) {
        return normalizeNotificationsConfig(/** @type {Record<string, unknown>} */ (agents));
      }
    } catch {
      /* next */
    }
  }

  return normalizeNotificationsConfig();
}

/**
 * Build guest notifications.json payload from hdc_agents config.
 *
 * @param {Record<string, unknown>} hdcAgents
 * @returns {Record<string, unknown>}
 */
export function buildNotificationsJson(hdcAgents) {
  const normalized = normalizeNotificationsConfig(hdcAgents);
  return {
    channels: normalized.channels,
    routes: normalized.routes,
    public_url: normalized.public_url || undefined,
  };
}
