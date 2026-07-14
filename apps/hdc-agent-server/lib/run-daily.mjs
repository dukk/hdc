import { buildDailyMaintainDiscordSummary } from "../../hdc-cli/lib/daily-maintain-discord.mjs";
import {
  handleHdcMaintainDaily,
  handleHdcNotifyDiscord,
} from "../../hdc-mcp-server/lib/tools.mjs";

/**
 * @typedef {object} RunDailyOptions
 * @property {boolean} [dryRun]
 * @property {boolean} [skipClients]
 * @property {boolean} [skipUpgrades]
 * @property {boolean} [skipDiscord]
 * @property {string} [titlePrefix]
 */

/**
 * Parse CLI argv for run-daily.
 * @param {string[]} argv
 * @returns {RunDailyOptions}
 */
export function parseRunDailyArgv(argv) {
  /** @type {RunDailyOptions} */
  const opts = {
    dryRun: false,
    skipClients: true,
    skipUpgrades: false,
    skipDiscord: false,
    titlePrefix: "[HDC]",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--skip-clients") opts.skipClients = true;
    else if (a === "--no-skip-clients") opts.skipClients = false;
    else if (a === "--skip-upgrades") opts.skipUpgrades = true;
    else if (a === "--skip-discord") opts.skipDiscord = true;
    else if (a === "--title-prefix" && argv[i + 1]) opts.titlePrefix = String(argv[++i]);
    else if (a === "--help" || a === "-h") {
      return { ...opts, help: true };
    }
  }
  return opts;
}

/**
 * @param {RunDailyOptions} opts
 * @returns {Promise<{ exitCode: number; result: Record<string, unknown> | null }>}
 */
export async function runDailyOpsWorkflow(opts) {
  const titlePrefix = String(opts.titlePrefix ?? "[HDC]").trim() || "[HDC]";
  const maintainArgs = {
    dry_run: opts.dryRun === true,
    skip_clients: opts.skipClients !== false,
    skip_upgrades: opts.skipUpgrades === true,
  };

  if (!opts.skipDiscord) {
    const started = await handleHdcNotifyDiscord({
      title: `${titlePrefix} hdc-ops-daily — started`,
      message: `Daily maintain started at ${new Date().toISOString()}`,
      silent: true,
      dry_run: opts.dryRun === true,
    });
    if (started.isError) {
      process.stderr.write(`hdc-ops-daily: discord start failed\n`);
    }
  }

  const maintainResult = await handleHdcMaintainDaily(maintainArgs);
  if (maintainResult.isError) {
    return { exitCode: 1, result: null };
  }

  const text = maintainResult.content?.[0]?.text ?? "{}";
  /** @type {Record<string, unknown>} */
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : 1;
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const summary = buildDailyMaintainDiscordSummary({
    exitCode,
    dryRun: parsed.dryRun === true,
    results,
  });

  if (!opts.skipDiscord) {
    const ok = exitCode === 0;
    const drySuffix = parsed.dryRun === true ? " (dry-run)" : "";
    await handleHdcNotifyDiscord({
      title: `${titlePrefix} hdc-ops-daily — ${ok ? "OK" : "FAILED"}${drySuffix}`,
      message: summary.message,
      silent: ok,
      dry_run: opts.dryRun === true,
    });
  }

  return { exitCode, result: parsed };
}
