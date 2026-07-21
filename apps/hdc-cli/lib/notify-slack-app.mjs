#!/usr/bin/env node
/**
 * Post an ops alert via the Slack HDC app (Bot API + optional Block Kit buttons).
 *
 * Usage:
 *   node apps/hdc-cli/lib/notify-slack-app.mjs --title "HDC" --message "…" [--decision --task-id <id>]
 *   node apps/hdc-cli/lib/notify-slack-app.mjs --message "body" --dry-run
 *
 * Secrets: HDC_SLACK_BOT_TOKEN; channel via HDC_SLACK_DECISION_CHANNEL (or --channel).
 * Never log secrets. Exit 2 when bot token/channel not configured (fan-out skip).
 */
import "./package/preload.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr, stdout } from "node:process";

import { loadDotenv } from "../env.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { createNodeCliDeps } from "./node-cli-deps.mjs";
import {
  SLACK_BOT_TOKEN_KEY,
  SLACK_DECISION_CHANNEL_ENV,
  buildSlackDecisionBlocks,
  formatSlackAppText,
  sendOpsSlackAppMessage,
} from "./ops-slack-app-notify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ title: string, message: string, dryRun: boolean, decision: boolean, taskId: string, channel: string }} */
  const out = {
    title: "HDC Ops",
    message: "",
    dryRun: false,
    decision: false,
    taskId: "",
    channel: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--decision") out.decision = true;
    else if (a === "--title" && argv[i + 1]) out.title = String(argv[++i]);
    else if (a === "--message" && argv[i + 1]) out.message = String(argv[++i]);
    else if ((a === "--task-id" || a === "--taskId") && argv[i + 1]) {
      out.taskId = String(argv[++i]);
    } else if (a === "--channel" && argv[i + 1]) out.channel = String(argv[++i]);
    else if (a === "--help" || a === "-h") {
      stderr.write(
        "usage: notify-slack-app.mjs --message <text> [--title <text>] [--decision --task-id <id>] [--channel <id>] [--dry-run]\n",
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const { title, message, dryRun, decision, taskId, channel } = parseArgs(
    process.argv.slice(2),
  );
  if (!message.trim() && !title.trim()) {
    stderr.write("notify-slack-app: --message or --title is required\n");
    process.exit(2);
  }
  if (decision && !taskId.trim()) {
    stderr.write("notify-slack-app: --task-id is required with --decision\n");
    process.exit(2);
  }

  const content = formatSlackAppText(title, message);

  if (dryRun) {
    loadDotenv(join(repoRoot, ".env"));
    stdout.write(
      `${JSON.stringify({
        ok: true,
        dry_run: true,
        content_length: content.length,
        content,
        decision: decision || undefined,
        task_id: taskId || undefined,
        blocks: decision ? buildSlackDecisionBlocks(taskId) : undefined,
        bot_token_vault_key: SLACK_BOT_TOKEN_KEY,
        channel_env: SLACK_DECISION_CHANNEL_ENV,
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
  const result = await sendOpsSlackAppMessage({
    content,
    decision,
    taskId,
    channelId: channel || undefined,
    env: deps.env,
    getSecret: (key, opts) => vault.getSecret(key, opts),
  });
  if (result.skipped) {
    stderr.write(
      `notify-slack-app: skipped (set ${SLACK_BOT_TOKEN_KEY} and ${SLACK_DECISION_CHANNEL_ENV})\n`,
    );
    process.exit(2);
  }
  if (!result.ok) {
    throw new Error(result.error || "slack app send failed");
  }
  stderr.write("notify-slack-app: sent (slack-hdc-app)\n");
  stdout.write(JSON.stringify({ ok: true, mode: "slack-hdc-app" }) + "\n");
}

main().catch((e) => {
  stderr.write(`notify-slack-app: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
