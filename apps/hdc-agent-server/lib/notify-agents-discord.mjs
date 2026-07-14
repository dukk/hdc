/**
 * Discord notifications from agent-server (silent event posts + decision alerts).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * @param {string} hdcRoot
 * @param {string} privateRoot
 * @param {string} title
 * @param {string} message
 * @param {{ silent?: boolean, taskId?: string, decision?: boolean }} [opts]
 */
export function notifyAgentsDiscord(hdcRoot, privateRoot, title, message, opts = {}) {
  const script = join(hdcRoot, "apps", "hdc-cli", "lib", "notify-discord.mjs");
  if (!existsSync(script)) {
    return { ok: false, error: "notify-discord.mjs missing" };
  }
  /** @type {string[]} */
  const args = [
    script,
    "--title",
    title,
    "--message",
    message,
    "--webhook-vault-key",
    "HDC_AGENTS_DISCORD_WEBHOOK_URL",
    "--fallback-webhook-vault-key",
    "HDC_OPS_DISCORD_WEBHOOK_URL",
  ];
  if (opts.silent !== false && !opts.decision) {
    args.push("--silent");
  }
  const tid = String(opts.taskId ?? "").trim();
  if (opts.decision && tid) {
    args.push("--decision", "--task-id", tid);
  }
  const r = spawnSync(process.execPath, args, {
    cwd: hdcRoot,
    env: { ...process.env, HDC_PRIVATE_ROOT: privateRoot || process.env.HDC_PRIVATE_ROOT },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { ok: r.status === 0, status: r.status, stderr: r.stderr?.slice(0, 500) };
}

/**
 * @param {string} hdcRoot
 * @param {string} privateRoot
 * @param {string} title
 * @param {string} message
 */
export function notifyDiscordSilent(hdcRoot, privateRoot, title, message) {
  return notifyAgentsDiscord(hdcRoot, privateRoot, title, message, { silent: true });
}

/**
 * @param {string} hdcRoot
 * @param {string} privateRoot
 * @param {string} title
 * @param {string} message
 * @param {string} [taskId]
 */
export function notifyDiscordDecision(hdcRoot, privateRoot, title, message, taskId) {
  return notifyAgentsDiscord(hdcRoot, privateRoot, title, message, {
    silent: false,
    decision: true,
    taskId,
  });
}
