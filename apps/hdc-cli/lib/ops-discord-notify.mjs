import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const OPS_DISCORD_WEBHOOK_KEY = "HDC_OPS_DISCORD_WEBHOOK_URL";
export const AGENTS_DISCORD_WEBHOOK_KEY = "HDC_AGENTS_DISCORD_WEBHOOK_URL";
export const OPS_DISCORD_NOTIFY_ENV = "HDC_OPS_DISCORD_NOTIFY";
export const OPS_DISCORD_HOST_ENV = "HDC_OPS_DISCORD_HOST";
export const OPS_DISCORD_APPLICATION_ID_ENV = "HDC_OPS_DISCORD_APPLICATION_ID";
export const OPS_DISCORD_PUBLIC_KEY_ENV = "HDC_OPS_DISCORD_PUBLIC_KEY";
export const OPS_DISCORD_BOT_TOKEN_ENV = "HDC_OPS_DISCORD_BOT_TOKEN";
export const OPS_DISCORD_CHANNEL_ID_ENV = "HDC_OPS_DISCORD_CHANNEL_ID";
export const DISCORD_SUPPRESS_NOTIFICATIONS_FLAG = 4096;
export const DISCORD_BUTTON_STYLE_SUCCESS = 3;
export const DISCORD_BUTTON_STYLE_DANGER = 4;
export const DISCORD_COMPONENT_ACTION_ROW = 1;
export const DISCORD_COMPONENT_BUTTON = 2;
const MAX_CONTENT = 1900;
const DEFAULT_DISCORD_API_BASE = "https://discord.com/api/v10";

const IPV4_CIDR_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
const IPV6_RE =
  /\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:\/\d{1,3})?\b|\b::(?:[0-9a-fA-F]{0,4}:){0,6}[0-9a-fA-F]{0,4}\b/g;

const here = dirname(fileURLToPath(import.meta.url));
const notifyDiscordScript = join(here, "notify-discord.mjs");

/**
 * @typedef {import("hdc/package/operation-report.mjs").OperationReportContext} OperationReportContext
 */

/**
 * @param {string} text
 * @returns {string}
 */
export function redactIpsFromText(text) {
  return String(text)
    .replace(IPV4_CIDR_RE, "[redacted]")
    .replace(IPV6_RE, "[redacted]");
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveOpsDiscordHost(env = process.env) {
  const override = String(env[OPS_DISCORD_HOST_ENV] ?? "").trim();
  if (override) return override;
  return hostname();
}

/**
 * @param {string} title
 * @param {string} message
 * @param {{ env?: NodeJS.ProcessEnv; host?: string }} [opts]
 * @returns {string}
 */
export function formatDiscordContent(title, message, opts = {}) {
  const host = opts.host ?? resolveOpsDiscordHost(opts.env);
  const titlePart = title.trim() || "HDC Ops";
  const header = host ? `**${titlePart}** · \`${host}\`` : `**${titlePart}**`;
  const body = message.trim();
  const text = body ? `${header}\n\n${body}` : header;
  return text.length > MAX_CONTENT ? `${text.slice(0, MAX_CONTENT - 3)}...` : text;
}

/**
 * @param {string} url
 * @param {string} content
 * @param {{ suppressNotifications?: boolean }} [opts]
 */
export async function postDiscordWebhook(url, content, opts = {}) {
  /** @type {{ content: string; flags?: number }} */
  const payload = { content };
  if (opts.suppressNotifications) {
    payload.flags = DISCORD_SUPPRESS_NOTIFICATIONS_FLAG;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(`Discord webhook HTTP ${res.status}: ${snippet}`);
  }
}

/**
 * Resolve Bot API credentials for interactive decision messages.
 * All four of application_id, public_key, bot_token, channel_id must be present.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @returns {Promise<{
 *   enabled: boolean;
 *   applicationId?: string;
 *   publicKey?: string;
 *   botToken?: string;
 *   channelId?: string;
 *   apiBase?: string;
 * }>}
 */
export async function resolveOpsDiscordInteractiveConfig(opts = {}) {
  const env = opts.env ?? process.env;
  const applicationId = String(env[OPS_DISCORD_APPLICATION_ID_ENV] ?? "").trim();
  const publicKey = String(env[OPS_DISCORD_PUBLIC_KEY_ENV] ?? "").trim();
  const channelId = String(env[OPS_DISCORD_CHANNEL_ID_ENV] ?? "").trim();
  let botToken = String(env[OPS_DISCORD_BOT_TOKEN_ENV] ?? "").trim();
  if (!botToken && opts.getSecret) {
    botToken = String(
      (await opts.getSecret(OPS_DISCORD_BOT_TOKEN_ENV, { optional: true })) ?? "",
    ).trim();
  }
  if (!applicationId || !publicKey || !botToken || !channelId) {
    return { enabled: false };
  }
  const apiBase = String(env.HDC_OPS_DISCORD_API_BASE ?? DEFAULT_DISCORD_API_BASE)
    .trim()
    .replace(/\/$/, "");
  return {
    enabled: true,
    applicationId,
    publicKey,
    botToken,
    channelId,
    apiBase: apiBase || DEFAULT_DISCORD_API_BASE,
  };
}

/**
 * @param {string} taskId
 * @returns {unknown[]}
 */
export function buildDecisionMessageComponents(taskId) {
  const id = String(taskId ?? "").trim();
  if (!id) throw new Error("taskId is required for decision buttons");
  return [
    {
      type: DISCORD_COMPONENT_ACTION_ROW,
      components: [
        {
          type: DISCORD_COMPONENT_BUTTON,
          style: DISCORD_BUTTON_STYLE_SUCCESS,
          label: "Approve",
          custom_id: `hdc:approve:${id}`,
        },
        {
          type: DISCORD_COMPONENT_BUTTON,
          style: DISCORD_BUTTON_STYLE_DANGER,
          label: "Deny",
          custom_id: `hdc:deny:${id}`,
        },
      ],
    },
  ];
}

/**
 * Post a channel message via Bot API (supports message components).
 *
 * @param {object} opts
 * @param {string} opts.botToken
 * @param {string} opts.channelId
 * @param {string} opts.content
 * @param {unknown[]} [opts.components]
 * @param {boolean} [opts.suppressNotifications]
 * @param {string} [opts.apiBase]
 */
export async function postDiscordBotChannelMessage(opts) {
  const apiBase = (opts.apiBase || DEFAULT_DISCORD_API_BASE).replace(/\/$/, "");
  const channelId = String(opts.channelId ?? "").trim();
  if (!channelId) throw new Error("channelId is required");
  const botToken = String(opts.botToken ?? "").trim();
  if (!botToken) throw new Error("botToken is required");

  /** @type {{ content: string; components?: unknown[]; flags?: number }} */
  const payload = { content: opts.content };
  if (Array.isArray(opts.components) && opts.components.length) {
    payload.components = opts.components;
  }
  if (opts.suppressNotifications) {
    payload.flags = DISCORD_SUPPRESS_NOTIFICATIONS_FLAG;
  }

  const res = await fetch(`${apiBase}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(`Discord Bot API HTTP ${res.status}: ${snippet}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * Send a decision-oriented Discord message: Bot + buttons when interactive config
 * is complete, otherwise plain webhook.
 *
 * @param {object} opts
 * @param {string} opts.content
 * @param {string} [opts.taskId]
 * @param {boolean} [opts.decision]
 * @param {boolean} [opts.suppressNotifications]
 * @param {string} [opts.webhookVaultKey]
 * @param {string} [opts.fallbackWebhookVaultKey]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @returns {Promise<{ ok: true; mode: "bot" | "webhook" }>}
 */
export async function sendOpsDiscordMessage(opts) {
  const decision = opts.decision === true;
  const taskId = String(opts.taskId ?? "").trim();
  if (decision && !taskId) {
    throw new Error("taskId is required when decision is true");
  }

  if (decision) {
    const interactive = await resolveOpsDiscordInteractiveConfig({
      env: opts.env,
      getSecret: opts.getSecret,
    });
    if (interactive.enabled && interactive.botToken && interactive.channelId) {
      await postDiscordBotChannelMessage({
        botToken: interactive.botToken,
        channelId: interactive.channelId,
        content: opts.content,
        components: buildDecisionMessageComponents(taskId),
        suppressNotifications: opts.suppressNotifications,
        apiBase: interactive.apiBase,
      });
      return { ok: true, mode: "bot" };
    }
  }

  const webhookVaultKey =
    typeof opts.webhookVaultKey === "string" && opts.webhookVaultKey.trim()
      ? opts.webhookVaultKey.trim()
      : OPS_DISCORD_WEBHOOK_KEY;
  const url = await resolveOpsDiscordWebhookUrl({
    env: opts.env,
    getSecret: opts.getSecret,
    webhookVaultKey,
    fallbackWebhookVaultKey: opts.fallbackWebhookVaultKey,
  });
  if (!url) {
    throw new Error(
      `set ${webhookVaultKey} in vault (or interactive Discord bot env for --decision)`,
    );
  }
  await postDiscordWebhook(url, opts.content, {
    suppressNotifications: opts.suppressNotifications,
  });
  return { ok: true, mode: "webhook" };
}

/**
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @param {string} [opts.webhookVaultKey]
 * @param {string} [opts.fallbackWebhookVaultKey]
 * @returns {Promise<string | null>}
 */
export async function resolveOpsDiscordWebhookUrl(opts = {}) {
  const env = opts.env ?? process.env;
  const key =
    typeof opts.webhookVaultKey === "string" && opts.webhookVaultKey.trim()
      ? opts.webhookVaultKey.trim()
      : OPS_DISCORD_WEBHOOK_KEY;
  const fromEnv = String(env[key] ?? "").trim();
  if (fromEnv) return fromEnv;
  if (opts.getSecret) {
    const fromVault = await opts.getSecret(key, { optional: true });
    const trimmed = String(fromVault ?? "").trim();
    if (trimmed) return trimmed;
  }
  const fallback =
    typeof opts.fallbackWebhookVaultKey === "string" && opts.fallbackWebhookVaultKey.trim()
      ? opts.fallbackWebhookVaultKey.trim()
      : "";
  if (fallback && fallback !== key) {
    return resolveOpsDiscordWebhookUrl({
      env,
      getSecret: opts.getSecret,
      webhookVaultKey: fallback,
    });
  }
  return null;
}

/**
 * @param {boolean | null} ok
 * @param {number | null} [exitCode]
 * @returns {string}
 */
function outcomeLabel(ok, exitCode) {
  if (ok === true) return "OK";
  if (ok === false) return "FAILED";
  if (exitCode === 0) return "OK";
  if (exitCode !== null && exitCode !== undefined && exitCode !== 0) return "FAILED";
  return "—";
}

/**
 * @param {Record<string, unknown> | null} payload
 * @returns {string[]}
 */
function systemIdsFromPayload(payload) {
  if (!payload) return [];
  /** @type {string[]} */
  const ids = [];
  const results = payload.results ?? payload.instances;
  if (Array.isArray(results)) {
    for (const r of results) {
      if (!r || typeof r !== "object" || Array.isArray(r)) continue;
      const row = /** @type {Record<string, unknown>} */ (r);
      const sid = row.system_id ?? row.systemId;
      if (typeof sid === "string" && sid.trim()) ids.push(sid.trim());
    }
  }
  const single = payload.system_id ?? payload.systemId ?? payload.host_id;
  if (typeof single === "string" && single.trim()) ids.push(single.trim());
  return [...new Set(ids)];
}

/**
 * @param {Record<string, unknown> | null} payload
 * @returns {Record<string, unknown>[]}
 */
function resultsFromPayload(payload) {
  if (!payload) return [];
  const results = payload.results ?? payload.instances;
  if (Array.isArray(results)) {
    return results.filter((r) => r && typeof r === "object" && !Array.isArray(r));
  }
  if (payload.system_id || payload.systemId || payload.host_id) {
    return [payload];
  }
  return [];
}

/**
 * @param {OperationReportContext} ctx
 * @returns {{ title: string, message: string }}
 */
export function buildOperationReportDiscordSummary(ctx) {
  const outcome = outcomeLabel(ctx.ok, ctx.exitCode);
  const drySuffix = ctx.dryRun ? " (dry-run)" : "";
  const title = `${ctx.clumpTitle} ${ctx.verb} — ${outcome}${drySuffix}`;

  /** @type {string[]} */
  const parts = [];

  const systemIds = systemIdsFromPayload(ctx.stdoutPayload);
  if (systemIds.length) parts.push(systemIds.join(", "));

  const ranSteps = ctx.steps.filter((s) => s.ran);
  if (ranSteps.length) {
    const okCount = ranSteps.filter((s) => s.ok === true).length;
    parts.push(`${okCount}/${ranSteps.length} steps ok`);
    const titles = ranSteps
      .filter((s) => s.ok === true)
      .slice(0, 3)
      .map((s) => s.title.trim())
      .filter(Boolean);
    if (titles.length) parts.push(titles.join(", "));
  }

  for (const r of resultsFromPayload(ctx.stdoutPayload).slice(0, 2)) {
    const msg = r.message;
    if (typeof msg === "string" && msg.trim()) parts.push(msg.trim());
  }

  if (!parts.length && typeof ctx.stdoutPayload?.message === "string") {
    parts.push(String(ctx.stdoutPayload.message).trim());
  }

  const message = redactIpsFromText(parts.filter(Boolean).join(" · "));
  return { title, message: message || "completed" };
}

/**
 * @typedef {import("hdc/clump/infrastructure/proxmox/lib/proxmox-maintain-report.mjs").MaintainReportContext} MaintainReportContext
 */

/**
 * @param {MaintainReportContext} ctx
 * @returns {{ title: string, message: string }}
 */
export function buildProxmoxMaintainDiscordSummary(ctx) {
  const outcome = outcomeLabel(null, ctx.exitCode);
  const drySuffix = ctx.dryRun ? " (dry-run)" : "";
  const title = `Proxmox maintain — ${outcome}${drySuffix}`;

  /** @type {string[]} */
  const parts = [];

  const ranSteps = ctx.steps.filter((s) => s.ran);
  if (ranSteps.length) {
    const okCount = ranSteps.filter((s) => s.ok === true).length;
    parts.push(`${okCount}/${ranSteps.length} steps ok`);
    const titles = ranSteps
      .filter((s) => s.ok === true)
      .slice(0, 3)
      .map((s) => s.title.trim())
      .filter(Boolean);
    if (titles.length) parts.push(titles.join(", "));
  }

  if (ctx.downHosts?.length) {
    parts.push(`down: ${ctx.downHosts.join(", ")}`);
  }

  const message = redactIpsFromText(parts.filter(Boolean).join(" · "));
  return { title, message: message || "completed" };
}

/**
 * @returns {boolean}
 */
export function opsDiscordNotifyEnabled() {
  const v = String(process.env[OPS_DISCORD_NOTIFY_ENV] ?? "").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

/**
 * @param {Record<string, boolean | string>} flags
 * @returns {boolean}
 */
export function opsDiscordNotifySkippedByFlags(flags) {
  return flags.noDiscordNotify === true;
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {boolean} [opts.silent]
 * @returns {{ ok: boolean; skipped?: boolean; error?: string }}
 */
export function sendOpsDiscordNotifyBestEffort(opts) {
  const title = String(opts.title ?? "").trim();
  const message = String(opts.message ?? "").trim();
  if (!title && !message) return { ok: false, skipped: true };

  const env = { ...(opts.env ?? process.env) };
  /** @type {string[]} */
  const args = [notifyDiscordScript, "--title", title, "--message", message];
  if (opts.silent === true) args.push("--silent");
  try {
    const r = spawnSync(process.execPath, args, {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status === 0) return { ok: true };
    const err = (r.stderr || r.stdout || "").trim();
    return { ok: false, error: err || `exit ${r.status ?? 1}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * @param {OperationReportContext} ctx
 * @returns {{ ok: boolean; skipped?: boolean; error?: string }}
 */
export function maybeNotifyOpsDiscordFromOperationReport(ctx) {
  if (ctx.verb !== "deploy" && ctx.verb !== "maintain") return { ok: false, skipped: true };
  if (!opsDiscordNotifyEnabled()) return { ok: false, skipped: true };
  if (opsDiscordNotifySkippedByFlags(ctx.flags)) return { ok: false, skipped: true };

  const { title, message } = buildOperationReportDiscordSummary(ctx);
  return sendOpsDiscordNotifyBestEffort({ title, message });
}

/**
 * @param {MaintainReportContext} ctx
 * @returns {{ ok: boolean; skipped?: boolean; error?: string }}
 */
export function maybeNotifyOpsDiscordFromProxmoxMaintain(ctx) {
  if (!opsDiscordNotifyEnabled()) return { ok: false, skipped: true };
  if (opsDiscordNotifySkippedByFlags(ctx.flags)) return { ok: false, skipped: true };

  const { title, message } = buildProxmoxMaintainDiscordSummary(ctx);
  return sendOpsDiscordNotifyBestEffort({ title, message });
}
