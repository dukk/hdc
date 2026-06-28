#!/usr/bin/env node
/**
 * Post a plain-text ops alert to Discord via webhook.
 *
 * Usage:
 *   node tools/hdc/lib/notify-discord.mjs --title "HDC" --message "Task foo needs approval"
 *   node tools/hdc/lib/notify-discord.mjs --message "body only" --dry-run
 *   node tools/hdc/lib/notify-discord.mjs --message "done" --silent
 *
 * Secret: HDC_OPS_DISCORD_WEBHOOK_URL (vault or env). Never log the URL.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr, stdout } from "node:process";

import { loadDotenv } from "../env.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { createNodeCliDeps } from "./node-cli-deps.mjs";
import {
  formatDiscordContent,
  OPS_DISCORD_WEBHOOK_KEY,
  postDiscordWebhook,
  resolveOpsDiscordWebhookUrl,
} from "./ops-discord-notify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ title: string, message: string, dryRun: boolean, silent: boolean }} */
  const out = { title: "HDC Ops", message: "", dryRun: false, silent: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--silent") out.silent = true;
    else if (a === "--title" && argv[i + 1]) out.title = String(argv[++i]);
    else if (a === "--message" && argv[i + 1]) out.message = String(argv[++i]);
    else if (a === "--help" || a === "-h") {
      stderr.write(
        "usage: notify-discord.mjs --message <text> [--title <text>] [--dry-run] [--silent]\n",
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const { title, message, dryRun, silent } = parseArgs(process.argv.slice(2));
  if (!message.trim()) {
    stderr.write("notify-discord: --message is required\n");
    process.exit(2);
  }

  const content = formatDiscordContent(title, message);

  if (dryRun) {
    stdout.write(
      `${JSON.stringify({ ok: true, dry_run: true, content_length: content.length, content })}\n`,
    );
    return;
  }

  loadDotenv(join(repoRoot, ".env"));

  const deps = createNodeCliDeps();
  const vault = createVaultAccess(vaultDepsFromCli(deps));
  const url = await resolveOpsDiscordWebhookUrl({
    env: deps.env,
    getSecret: (key, opts) => vault.getSecret(key, opts),
  });

  if (!url) {
    stderr.write(
      `notify-discord: set ${OPS_DISCORD_WEBHOOK_KEY} in vault (node tools/hdc/cli.mjs secrets set ${OPS_DISCORD_WEBHOOK_KEY})\n`,
    );
    process.exit(1);
  }

  await postDiscordWebhook(url, content, { suppressNotifications: silent });
  stderr.write("notify-discord: sent\n");
  stdout.write(JSON.stringify({ ok: true }) + "\n");
}

main().catch((e) => {
  stderr.write(`notify-discord: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
