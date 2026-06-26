import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const OPS_DISCORD_WEBHOOK_KEY = "HDC_OPS_DISCORD_WEBHOOK_URL";
export const OPS_DISCORD_NOTIFY_ENV = "HDC_OPS_DISCORD_NOTIFY";
const MAX_CONTENT = 1900;

const IPV4_CIDR_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
const IPV6_RE =
  /\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:\/\d{1,3})?\b|\b::(?:[0-9a-fA-F]{0,4}:){0,6}[0-9a-fA-F]{0,4}\b/g;

const here = dirname(fileURLToPath(import.meta.url));
const notifyDiscordScript = join(here, "notify-discord.mjs");

/**
 * @typedef {import("../../../packages/lib/operation-report.mjs").OperationReportContext} OperationReportContext
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
 * @param {string} title
 * @param {string} message
 * @returns {string}
 */
export function formatDiscordContent(title, message) {
  const header = `**${title.trim() || "HDC Ops"}**`;
  const body = message.trim();
  const text = body ? `${header}\n\n${body}` : header;
  return text.length > MAX_CONTENT ? `${text.slice(0, MAX_CONTENT - 3)}...` : text;
}

/**
 * @param {string} url
 * @param {string} content
 */
export async function postDiscordWebhook(url, content) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(`Discord webhook HTTP ${res.status}: ${snippet}`);
  }
}

/**
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @returns {Promise<string | null>}
 */
export async function resolveOpsDiscordWebhookUrl(opts = {}) {
  const env = opts.env ?? process.env;
  const fromEnv = String(env[OPS_DISCORD_WEBHOOK_KEY] ?? "").trim();
  if (fromEnv) return fromEnv;
  if (opts.getSecret) {
    const fromVault = await opts.getSecret(OPS_DISCORD_WEBHOOK_KEY, { optional: true });
    const trimmed = String(fromVault ?? "").trim();
    if (trimmed) return trimmed;
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
  const title = `${ctx.packageTitle} ${ctx.verb} — ${outcome}${drySuffix}`;

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
 * @typedef {import("../../../packages/infrastructure/proxmox/lib/proxmox-maintain-report.mjs").MaintainReportContext} MaintainReportContext
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
 * @returns {{ ok: boolean; skipped?: boolean; error?: string }}
 */
export function sendOpsDiscordNotifyBestEffort(opts) {
  const title = String(opts.title ?? "").trim();
  const message = String(opts.message ?? "").trim();
  if (!title && !message) return { ok: false, skipped: true };

  const env = { ...(opts.env ?? process.env) };
  try {
    const r = spawnSync(process.execPath, [notifyDiscordScript, "--title", title, "--message", message], {
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
