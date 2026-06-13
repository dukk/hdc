#!/usr/bin/env node
/**
 * Post a plain-text ops alert to Discord via webhook.
 *
 * Usage:
 *   node tools/hdc/lib/notify-discord.mjs --title "HDC" --message "Task foo needs approval"
 *   node tools/hdc/lib/notify-discord.mjs --message "body only" --dry-run
 *
 * Secret: HDC_OPS_DISCORD_WEBHOOK_URL (vault or env). Never log the URL.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr, stdout } from "node:process";

import { loadDotenv } from "../env.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { createNodeCliDeps } from "./node-cli-deps.mjs";

const WEBHOOK_KEY = "HDC_OPS_DISCORD_WEBHOOK_URL";
const MAX_CONTENT = 1900;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ title: string, message: string, dryRun: boolean }} */
  const out = { title: "HDC Ops", message: "", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--title" && argv[i + 1]) out.title = String(argv[++i]);
    else if (a === "--message" && argv[i + 1]) out.message = String(argv[++i]);
    else if (a === "--help" || a === "-h") {
      stderr.write(
        "usage: notify-discord.mjs --message <text> [--title <text>] [--dry-run]\n",
      );
      process.exit(0);
    }
  }
  return out;
}

/**
 * @param {string} title
 * @param {string} message
 */
function formatContent(title, message) {
  const header = `**${title.trim() || "HDC Ops"}**`;
  const body = message.trim();
  const text = body ? `${header}\n\n${body}` : header;
  return text.length > MAX_CONTENT ? `${text.slice(0, MAX_CONTENT - 3)}...` : text;
}

/**
 * @param {string} url
 * @param {string} content
 */
async function postWebhook(url, content) {
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

async function main() {
  const { title, message, dryRun } = parseArgs(process.argv.slice(2));
  if (!message.trim()) {
    stderr.write("notify-discord: --message is required\n");
    process.exit(2);
  }

  const content = formatContent(title, message);

  if (dryRun) {
    stdout.write(`${JSON.stringify({ ok: true, dry_run: true, content_length: content.length })}\n`);
    return;
  }

  loadDotenv(join(repoRoot, ".env"));

  const deps = createNodeCliDeps();
  const vault = createVaultAccess(vaultDepsFromCli(deps));
  const url = String(
    deps.env[WEBHOOK_KEY] ??
      (await vault.getSecret(WEBHOOK_KEY, { optional: true })) ??
      "",
  ).trim();

  if (!url) {
    stderr.write(
      `notify-discord: set ${WEBHOOK_KEY} in vault (node tools/hdc/cli.mjs secrets set ${WEBHOOK_KEY})\n`,
    );
    process.exit(1);
  }

  await postWebhook(url, content);
  stderr.write("notify-discord: sent\n");
  stdout.write(JSON.stringify({ ok: true }) + "\n");
}

main().catch((e) => {
  stderr.write(`notify-discord: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
