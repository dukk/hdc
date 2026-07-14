#!/usr/bin/env node
/**
 * Deterministic daily hdc maintain + Discord reporting (no LLM).
 *
 * Usage:
 *   node apps/hdc-agent-server/bin/run-daily.mjs [--dry-run] [--skip-discord] [--no-skip-clients]
 */
import { parseRunDailyArgv, runDailyOpsWorkflow } from "../lib/run-daily.mjs";

function printHelp() {
  process.stderr.write(
    [
      "usage: run-daily.mjs [--dry-run] [--skip-discord] [--no-skip-clients] [--skip-upgrades]",
      "                     [--title-prefix <text>]",
      "",
    ].join("\n"),
  );
}

async function main() {
  const opts = parseRunDailyArgv(process.argv.slice(2));
  if ("help" in opts && opts.help) {
    printHelp();
    process.exit(0);
  }

  process.stderr.write(
    `[hdc-ops-daily] starting${opts.dryRun ? " (dry-run)" : ""} skip_clients=${opts.skipClients !== false}\n`,
  );

  const { exitCode, result } = await runDailyOpsWorkflow(opts);
  if (result) {
    process.stdout.write(`${JSON.stringify({ ok: exitCode === 0, exitCode, ...result })}\n`);
  }
  process.stderr.write(`[hdc-ops-daily] finished exit=${exitCode}\n`);
  process.exit(exitCode);
}

main().catch((e) => {
  process.stderr.write(`hdc-ops-daily: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
