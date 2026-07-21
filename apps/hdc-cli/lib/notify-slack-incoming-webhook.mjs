#!/usr/bin/env node
/**
 * Post a plain-text ops alert to Slack via Incoming Webhook.
 *
 * Usage:
 *   node apps/hdc-cli/lib/notify-slack-incoming-webhook.mjs --title "HDC" --message "Task foo needs approval"
 *   node apps/hdc-cli/lib/notify-slack-incoming-webhook.mjs --message "body only" --dry-run
 *
 * Secrets: HDC_OPS_SLACK_WEBHOOK_URL then HDC_AGENTS_SLACK_WEBHOOK_URL (vault or env).
 * Never log secrets. Exit 2 when webhook is not configured (fan-out skip).
 */
import "./package/preload.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr, stdout } from "node:process";

import { loadDotenv } from "../env.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { createNodeCliDeps } from "./node-cli-deps.mjs";
import {
  AGENTS_SLACK_WEBHOOK_KEY,
  formatSlackIncomingWebhookText,
  OPS_SLACK_WEBHOOK_KEY,
  sendOpsSlackIncomingWebhookMessage,
} from "./ops-slack-incoming-webhook.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ title: string, message: string, dryRun: boolean }} */
  const out = {
    title: "HDC Ops",
    message: "",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--title" && argv[i + 1]) out.title = String(argv[++i]);
    else if (a === "--message" && argv[i + 1]) out.message = String(argv[++i]);
    else if (a === "--help" || a === "-h") {
      stderr.write(
        "usage: notify-slack-incoming-webhook.mjs --message <text> [--title <text>] [--dry-run]\n",
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const { title, message, dryRun } = parseArgs(process.argv.slice(2));
  if (!message.trim() && !title.trim()) {
    stderr.write("notify-slack-incoming-webhook: --message or --title is required\n");
    process.exit(2);
  }

  const content = formatSlackIncomingWebhookText(title, message);

  if (dryRun) {
    loadDotenv(join(repoRoot, ".env"));
    stdout.write(
      `${JSON.stringify({
        ok: true,
        dry_run: true,
        content_length: content.length,
        content,
        webhook_vault_keys: [OPS_SLACK_WEBHOOK_KEY, AGENTS_SLACK_WEBHOOK_KEY],
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
  const result = await sendOpsSlackIncomingWebhookMessage({
    content,
    env: deps.env,
    getSecret: (key, opts) => vault.getSecret(key, opts),
  });
  if (result.skipped) {
    stderr.write(
      `notify-slack-incoming-webhook: skipped (set ${OPS_SLACK_WEBHOOK_KEY} or ${AGENTS_SLACK_WEBHOOK_KEY} in vault)\n`,
    );
    process.exit(2);
  }
  if (!result.ok) {
    throw new Error(result.error || "slack incoming webhook send failed");
  }
  stderr.write("notify-slack-incoming-webhook: sent (slack-incoming-webhook)\n");
  stdout.write(JSON.stringify({ ok: true, mode: "slack-incoming-webhook" }) + "\n");
}

main().catch((e) => {
  stderr.write(
    `notify-slack-incoming-webhook: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(1);
});
