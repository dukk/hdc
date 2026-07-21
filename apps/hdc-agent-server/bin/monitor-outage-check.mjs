#!/usr/bin/env node
/**
 * Deterministic monitor outage pre-check (uptime-kuma, homepage, proxmox).
 *
 * Usage:
 *   node apps/hdc-agent-server/bin/monitor-outage-check.mjs [--dry-run]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runMonitorOutageCheck } from "../lib/monitor-outage-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const hdcRoot = process.env.HDC_ROOT?.trim() || join(here, "..", "..", "..");
const privateRoot = process.env.HDC_PRIVATE_ROOT?.trim() || "";

function printHelp() {
  process.stderr.write("usage: monitor-outage-check.mjs [--dry-run]\n");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (!privateRoot) {
    process.stderr.write("[monitor-outage-check] HDC_PRIVATE_ROOT unset\n");
    process.exit(1);
  }

  const result = runMonitorOutageCheck({
    hdcRoot,
    privateRoot,
    dryRun,
    log: (line) => process.stderr.write(`${line}\n`),
  });

  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  process.stderr.write(
    `[monitor-outage-check] outages=${result.outages.length} invoke_llm=${result.should_invoke_llm}\n`,
  );
  process.exit(result.has_outages && !result.same_as_last_cycle ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`monitor-outage-check: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
