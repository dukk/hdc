/**
 * Multi-channel manager/ops notifications (Discord, email, Slack, Teams, Telegram).
 */
import {
  AGENTS_DISCORD_WEBHOOK_KEY,
  formatDiscordContent,
  formatNotifyAttributionHeader,
  OPS_DISCORD_APPLICATION_ID_ENV,
  OPS_DISCORD_BOT_TOKEN_ENV,
  OPS_DISCORD_CHANNEL_ID_ENV,
  OPS_DISCORD_PUBLIC_KEY_ENV,
  OPS_DISCORD_WEBHOOK_KEY,
  redactIpsFromText,
  sendOpsDiscordMessage,
} from "./ops-discord-notify.mjs";
import { sendPlainEmail } from "./package/report-email.mjs";
import {
  MANAGER_ROUTE_KEYS,
  NOTIFY_CHANNEL_IDS,
  normalizeNotificationsConfig,
  normalizeNotifyChannelId,
} from "./notifications-config.mjs";
import { sendOpsSlackIncomingWebhookMessage } from "./ops-slack-incoming-webhook.mjs";
import { sendOpsSlackAppMessage } from "./ops-slack-app-notify.mjs";

export { MANAGER_ROUTE_KEYS, NOTIFY_CHANNEL_IDS, normalizeNotificationsConfig };

const MAX_TEXT = 1900;

/**
 * @param {string} title
 * @param {string} message
 * @param {{ env?: NodeJS.ProcessEnv; host?: string; system?: string; app?: string }} [opts]
 * @returns {string}
 */
export function formatNotifyBody(title, message, opts = {}) {
  const discordHeader = formatNotifyAttributionHeader(title.trim() || "HDC", opts);
  // Plain-text channels: drop markdown bold markers from the shared header.
  const header = discordHeader.replace(/\*\*/g, "");
  const body = message.trim();
  const text = body ? `${header}\n\n${body}` : header;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text;
}

/**
 * @param {object} opts
 * @param {string} [opts.taskId]
 * @param {boolean} [opts.decision]
 * @param {string} [opts.publicUrl]
 * @param {string} message
 * @returns {string}
 */
export function appendDecisionFooter(opts, message) {
  const taskId = String(opts.taskId ?? "").trim();
  if (!opts.decision || !taskId) return message;
  const lines = [
    message,
    "",
    `Task ID: ${taskId}`,
    "",
    "Approve or reject by email to the manager mailbox:",
    `  Subject: APPROVE ${taskId}`,
    `  Subject: REJECT ${taskId}`,
  ];
  const publicUrl = String(opts.publicUrl ?? "").trim().replace(/\/+$/, "");
  if (publicUrl) {
    lines.push("", `Tasks UI: ${publicUrl}/tasks`);
  }
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} channelConfig
 * @param {string} vaultKey
 * @param {NodeJS.ProcessEnv} env
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [getSecret]
 * @returns {Promise<string>}
 */
async function resolveVaultOrEnv(channelConfig, vaultKey, env, getSecret) {
  const key =
    typeof channelConfig[vaultKey] === "string" && String(channelConfig[vaultKey]).trim()
      ? String(channelConfig[vaultKey]).trim()
      : vaultKey;
  let val = String(env[key] ?? "").trim();
  if (!val && getSecret) {
    val = String((await getSecret(key, { optional: true })) ?? "").trim();
  }
  return val;
}

/**
 * @param {import("./notifications-config.mjs").NotifyChannelId} channel
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {Record<string, unknown>} opts.channelConfig
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @param {boolean} [opts.silent]
 * @param {boolean} [opts.decision]
 * @param {string} [opts.taskId]
 * @param {string} [opts.publicUrl]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {typeof import("node:child_process").spawnSync} [opts.spawnSyncFn]
 * @returns {Promise<{ ok: boolean; mode?: string; skipped?: boolean; error?: string }>}
 */
export async function sendNotify(opts) {
  const channel =
    normalizeNotifyChannelId(opts.channel, { warn: false }) ?? opts.channel;
  const env = opts.env ?? process.env;
  const title = String(opts.title ?? "HDC").trim() || "HDC";
  const rawMessage = redactIpsFromText(String(opts.message ?? ""));
  const body = formatNotifyBody(title, rawMessage, { env });
  const channelConfig = opts.channelConfig ?? {};

  if (channelConfig.enabled === false) {
    return { ok: false, skipped: true, error: "channel disabled" };
  }

  switch (channel) {
    case "discord": {
      const webhookKeyName =
        typeof channelConfig.webhook_vault_key === "string" &&
        String(channelConfig.webhook_vault_key).trim()
          ? String(channelConfig.webhook_vault_key).trim()
          : AGENTS_DISCORD_WEBHOOK_KEY;
      const fallbackKey =
        typeof channelConfig.fallback_webhook_vault_key === "string"
          ? channelConfig.fallback_webhook_vault_key.trim()
          : OPS_DISCORD_WEBHOOK_KEY;
      const discordEnv = { ...env };
      const appId = String(channelConfig.application_id ?? "").trim();
      const publicKey = String(channelConfig.public_key ?? "").trim();
      const channelId = String(channelConfig.channel_id ?? "").trim();
      if (appId) discordEnv[OPS_DISCORD_APPLICATION_ID_ENV] = appId;
      if (publicKey) discordEnv[OPS_DISCORD_PUBLIC_KEY_ENV] = publicKey;
      if (channelId) discordEnv[OPS_DISCORD_CHANNEL_ID_ENV] = channelId;
      const botKey =
        typeof channelConfig.bot_token_vault_key === "string"
          ? channelConfig.bot_token_vault_key.trim()
          : OPS_DISCORD_BOT_TOKEN_ENV;
      if (env[botKey]) discordEnv[OPS_DISCORD_BOT_TOKEN_ENV] = String(env[botKey]);

      const content = formatDiscordContent(title, rawMessage, { env });
      try {
        const result = await sendOpsDiscordMessage({
          content,
          decision: opts.decision === true,
          taskId: opts.taskId,
          suppressNotifications: opts.silent === true,
          webhookVaultKey: webhookKeyName,
          fallbackWebhookVaultKey: fallbackKey || undefined,
          env: discordEnv,
          getSecret: opts.getSecret,
        });
        return { ok: true, mode: result.mode };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case "email": {
      const to = String(channelConfig.to ?? "").trim();
      const from = String(channelConfig.from ?? "").trim();
      const prefix = String(channelConfig.subject_prefix ?? "[HDC]").trim() || "[HDC]";
      if (!to) return { ok: false, skipped: true, error: "email to not configured" };
      const markdown = appendDecisionFooter(
        {
          taskId: opts.taskId,
          decision: opts.decision,
          publicUrl: opts.publicUrl,
        },
        body,
      );
      const result = sendPlainEmail({
        to,
        from,
        subject: `${prefix} ${title}`,
        markdown,
        env,
        spawnSyncFn: opts.spawnSyncFn,
      });
      return result.ok
        ? { ok: true, mode: "email" }
        : { ok: false, error: result.message };
    }
    case "slack-incoming-webhook": {
      const text = appendDecisionFooter(
        { taskId: opts.taskId, decision: opts.decision, publicUrl: opts.publicUrl },
        body,
      );
      const webhookKey =
        typeof channelConfig.webhook_vault_key === "string" &&
        channelConfig.webhook_vault_key.trim()
          ? channelConfig.webhook_vault_key.trim()
          : "HDC_AGENTS_SLACK_WEBHOOK_URL";
      return sendOpsSlackIncomingWebhookMessage({
        content: text,
        env,
        getSecret: opts.getSecret,
        webhookVaultKey: webhookKey,
        fetchFn: opts.fetchFn,
      });
    }
    case "slack-hdc-app": {
      return sendOpsSlackAppMessage({
        title,
        message: rawMessage,
        decision: opts.decision === true,
        taskId: opts.taskId,
        publicUrl: opts.publicUrl,
        env,
        getSecret: opts.getSecret,
        botTokenVaultKey:
          typeof channelConfig.bot_token_vault_key === "string"
            ? channelConfig.bot_token_vault_key.trim()
            : undefined,
        channelId:
          typeof channelConfig.channel_id === "string"
            ? channelConfig.channel_id.trim()
            : undefined,
        channelEnv:
          typeof channelConfig.channel_env === "string"
            ? channelConfig.channel_env.trim()
            : undefined,
        fetchFn: opts.fetchFn,
      });
    }
    case "teams": {
      const url = await resolveVaultOrEnv(
        channelConfig,
        "webhook_vault_key",
        env,
        opts.getSecret,
      );
      if (!url) return { ok: false, skipped: true, error: "teams webhook not configured" };
      const fetchFn = opts.fetchFn ?? fetch;
      const text = appendDecisionFooter(
        { taskId: opts.taskId, decision: opts.decision, publicUrl: opts.publicUrl },
        body,
      );
      const payload = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        summary: title,
        themeColor: opts.decision ? "E81123" : "0078D4",
        title,
        text: text.replace(/\n/g, "<br>"),
      };
      try {
        const res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const snippet = (await res.text()).slice(0, 200);
          return { ok: false, error: `Teams HTTP ${res.status}: ${snippet}` };
        }
        return { ok: true, mode: "teams" };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case "telegram": {
      const token = await resolveVaultOrEnv(
        channelConfig,
        "bot_token_vault_key",
        env,
        opts.getSecret,
      );
      const chatId = String(channelConfig.chat_id ?? "").trim();
      if (!token || !chatId) {
        return { ok: false, skipped: true, error: "telegram bot token or chat_id not configured" };
      }
      const fetchFn = opts.fetchFn ?? fetch;
      const text = appendDecisionFooter(
        { taskId: opts.taskId, decision: opts.decision, publicUrl: opts.publicUrl },
        body,
      );
      try {
        const res = await fetchFn(
          `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              disable_web_page_preview: true,
            }),
          },
        );
        if (!res.ok) {
          const snippet = (await res.text()).slice(0, 200);
          return { ok: false, error: `Telegram HTTP ${res.status}: ${snippet}` };
        }
        const data = await res.json().catch(() => ({}));
        if (data && data.ok === false) {
          return { ok: false, error: `Telegram API: ${String(data.description ?? "error")}` };
        }
        return { ok: true, mode: "telegram" };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    default:
      return { ok: false, skipped: true, error: `unknown channel: ${channel}` };
  }
}

/**
 * Fan-out a manager notification to all channels configured for a route.
 *
 * @param {object} opts
 * @param {import("./notifications-config.mjs").ManagerRouteKey} opts.routeKey
 * @param {ReturnType<typeof normalizeNotificationsConfig>} opts.config
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @param {boolean} [opts.silent]
 * @param {boolean} [opts.decision]
 * @param {string} [opts.taskId]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {typeof import("node:child_process").spawnSync} [opts.spawnSyncFn]
 * @returns {Promise<{ ok: boolean; results: Record<string, { ok: boolean; mode?: string; skipped?: boolean; error?: string }> }>}
 */
export async function sendNotifyRoute(opts) {
  const config = opts.config ?? normalizeNotificationsConfig();
  const routeKey = opts.routeKey;
  const channels = config.routes[routeKey] ?? [];
  const publicUrl =
    String(config.public_url ?? "").trim() ||
    String(opts.env?.HDC_WEB_PUBLIC_URL ?? "").trim();

  /** @type {Record<string, { ok: boolean; mode?: string; skipped?: boolean; error?: string }>} */
  const results = {};
  let anySent = false;

  for (const channelId of channels) {
    const channelConfig = config.channels[channelId] ?? {};
    const result = await sendNotify({
      channel: channelId,
      title: opts.title,
      message: opts.message,
      channelConfig,
      env: opts.env,
      getSecret: opts.getSecret,
      silent: opts.silent,
      decision: opts.decision,
      taskId: opts.taskId,
      publicUrl,
      fetchFn: opts.fetchFn,
      spawnSyncFn: opts.spawnSyncFn,
    });
    results[channelId] = result;
    if (result.ok) anySent = true;
  }

  return { ok: anySent, results };
}
