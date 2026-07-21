#!/usr/bin/env node
/**
 * Daily rollup of hdc-scheduler job logs → Discord/Slack (silent).
 *
 * Usage:
 *   node apps/hdc-agent-server/bin/schedule-summary.mjs [--dry-run] [--skip-discord]
 *     [--title-prefix <text>] [--window-hours <n>]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScheduleSummary } from "../lib/schedule-summary.mjs";
import { handleHdcNotifyDiscord } from "../../hdc-mcp-server/lib/tools.mjs";

/**
 * @param {string} path
 */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

/**
 * @param {string[]} argv
 */
function parseArgv(argv) {
  /** @type {{ dryRun: boolean, skipDiscord: boolean, titlePrefix: string, windowHours: number, help?: boolean }} */
  const opts = {
    dryRun: false,
    skipDiscord: false,
    titlePrefix: "[HDC]",
    windowHours: 24,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--skip-discord") opts.skipDiscord = true;
    else if (a === "--title-prefix" && argv[i + 1]) opts.titlePrefix = String(argv[++i]);
    else if (a === "--window-hours" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) opts.windowHours = n;
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  process.stderr.write(
    [
      "usage: schedule-summary.mjs [--dry-run] [--skip-discord]",
      "                            [--title-prefix <text>] [--window-hours <n>]",
      "",
    ].join("\n"),
  );
}

async function main() {
  const opts = parseArgv(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const metaRoot = process.env.HDC_AGENTS_META_ROOT || "/opt/hdc-agents-meta";
  loadDotEnv(join(metaRoot, ".env"));

  const summary = buildScheduleSummary({
    metaRoot,
    windowMs: opts.windowHours * 60 * 60 * 1000,
    titlePrefix: opts.titlePrefix,
  });

  process.stderr.write(
    `[schedule-summary] jobs=${summary.stats.length} runs=${summary.totalRuns} fail=${summary.totalFail}\n`,
  );

  if (!opts.skipDiscord) {
    const notified = await handleHdcNotifyDiscord({
      title: summary.title,
      message: summary.message,
      silent: true,
      dry_run: opts.dryRun === true,
    });
    if (notified.isError) {
      process.stderr.write(`schedule-summary: discord notify failed\n`);
      process.exit(1);
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      all_ok: summary.allOk,
      total_runs: summary.totalRuns,
      total_fail: summary.totalFail,
      message: summary.message,
      stats: summary.stats,
    })}\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`schedule-summary: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
