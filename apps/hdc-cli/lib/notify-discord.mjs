#!/usr/bin/env node
/**
 * Post a plain-text ops alert to Discord via webhook (or Bot API with decision buttons).
 *
 * Usage:
 *   node apps/hdc-cli/lib/notify-discord.mjs --title "HDC" --message "Task foo needs approval"
 *   node apps/hdc-cli/lib/notify-discord.mjs --message "body only" --dry-run
 *   node apps/hdc-cli/lib/notify-discord.mjs --message "done" --silent
 *   node apps/hdc-cli/lib/notify-discord.mjs --decision --task-id foo --title "…" --message "…"
 *
 * Secrets: HDC_OPS_DISCORD_WEBHOOK_URL (vault or env) by default; override with
 * --webhook-vault-key (e.g. HDC_AGENTS_DISCORD_WEBHOOK_URL). For decision buttons also
 * HDC_OPS_DISCORD_APPLICATION_ID, HDC_OPS_DISCORD_PUBLIC_KEY, HDC_OPS_DISCORD_BOT_TOKEN,
 * HDC_OPS_DISCORD_CHANNEL_ID. Never log secrets.
 */
import "./package/preload.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr, stdout } from "node:process";

import { loadDotenv } from "../env.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { createNodeCliDeps } from "./node-cli-deps.mjs";
import {
  formatDiscordContent,
  OPS_DISCORD_WEBHOOK_KEY,
  resolveOpsDiscordInteractiveConfig,
  sendOpsDiscordMessage,
} from "./ops-discord-notify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ title: string, message: string, dryRun: boolean, silent: boolean, decision: boolean, taskId: string, webhookVaultKey: string, fallbackWebhookVaultKey: string }} */
  const out = {
    title: "HDC Ops",
    message: "",
    dryRun: false,
    silent: false,
    decision: false,
    taskId: "",
    webhookVaultKey: "",
    fallbackWebhookVaultKey: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--silent") out.silent = true;
    else if (a === "--decision") out.decision = true;
    else if (a === "--title" && argv[i + 1]) out.title = String(argv[++i]);
    else if (a === "--message" && argv[i + 1]) out.message = String(argv[++i]);
    else if ((a === "--task-id" || a === "--task_id") && argv[i + 1]) out.taskId = String(argv[++i]);
    else if ((a === "--webhook-vault-key" || a === "--webhook_vault_key") && argv[i + 1]) {
      out.webhookVaultKey = String(argv[++i]);
    } else if (
      (a === "--fallback-webhook-vault-key" || a === "--fallback_webhook_vault_key") &&
      argv[i + 1]
    ) {
      out.fallbackWebhookVaultKey = String(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      stderr.write(
        "usage: notify-discord.mjs --message <text> [--title <text>] [--dry-run] [--silent]\n" +
          "       [--decision --task-id <id>] [--webhook-vault-key <ENV_NAME>]\n" +
          "       [--fallback-webhook-vault-key <ENV_NAME>]\n",
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const {
    title,
    message,
    dryRun,
    silent,
    decision,
    taskId,
    webhookVaultKey,
    fallbackWebhookVaultKey,
  } = parseArgs(process.argv.slice(2));
  if (!message.trim()) {
    stderr.write("notify-discord: --message is required\n");
    process.exit(2);
  }
  if (decision && !taskId.trim()) {
    stderr.write("notify-discord: --task-id is required with --decision\n");
    process.exit(2);
  }

  const content = formatDiscordContent(title, message);
  const resolvedWebhookKey = webhookVaultKey.trim() || OPS_DISCORD_WEBHOOK_KEY;

  if (dryRun) {
    loadDotenv(join(repoRoot, ".env"));
    const interactive = decision
      ? await resolveOpsDiscordInteractiveConfig({ env: process.env })
      : { enabled: false };
    stdout.write(
      `${JSON.stringify({
        ok: true,
        dry_run: true,
        content_length: content.length,
        content,
        decision: decision || undefined,
        task_id: taskId || undefined,
        webhook_vault_key: resolvedWebhookKey,
        fallback_webhook_vault_key: fallbackWebhookVaultKey.trim() || undefined,
        interactive: interactive.enabled === true,
        mode: decision && interactive.enabled ? "bot" : "webhook",
      })}\n`,
    );
    return;
  }

  loadDotenv(join(repoRoot, ".env"));
  loadDotenv(
    join(
      process.env.HDC_WEB_META_ROOT ||
        process.env.HDC_AGENTS_META_ROOT ||
        process.env.HDC_RUNNER_META_ROOT ||
        "/opt/hdc-agents-meta",
      ".env",
    ),
  );

  const deps = createNodeCliDeps();
  const vault = createVaultAccess(vaultDepsFromCli(deps));

  try {
    const result = await sendOpsDiscordMessage({
      content,
      decision,
      taskId,
      suppressNotifications: silent,
      webhookVaultKey: resolvedWebhookKey,
      fallbackWebhookVaultKey: fallbackWebhookVaultKey.trim() || undefined,
      env: deps.env,
      getSecret: (key, opts) => vault.getSecret(key, opts),
    });
    stderr.write(`notify-discord: sent (${result.mode})\n`);
    stdout.write(JSON.stringify({ ok: true, mode: result.mode }) + "\n");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes(resolvedWebhookKey) || msg.includes("interactive")) {
      stderr.write(
        `notify-discord: set ${resolvedWebhookKey} in vault (hdc secrets set ${resolvedWebhookKey})\n`,
      );
    }
    throw e;
  }
}

main().catch((e) => {
  stderr.write(`notify-discord: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
