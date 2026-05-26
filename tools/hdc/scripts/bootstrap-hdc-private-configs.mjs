#!/usr/bin/env node
/**
 * Seed hdc-private package configs from public hdc config.example.json templates.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  parseBootstrapArgs,
  runBootstrapHdcPrivateConfigs,
} from "../lib/bootstrap-hdc-private-configs.mjs";
import { repoRoot } from "../paths.mjs";

function printHelp() {
  console.error(`bootstrap-hdc-private-configs - copy packages config.example.json to hdc-private as config.json

Usage:
  node tools/hdc/scripts/bootstrap-hdc-private-configs.mjs [options]

Options:
  --dry-run              Print actions without writing files
  --force                Overwrite existing config.json in hdc-private
  --private-root <path>  Override hdc-private location (else HDC_PRIVATE_ROOT or ../hdc-private)
  -h, --help             Show this help
`);
}

function main() {
  const parsed = parseBootstrapArgs(process.argv.slice(2));
  if ("help" in parsed && parsed.help) {
    printHelp();
    return;
  }

  const publicRoot = repoRoot();
  runBootstrapHdcPrivateConfigs(publicRoot, {
    dryRun: parsed.dryRun,
    force: parsed.force,
    privateRoot: parsed.privateRoot,
  });
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
