#!/usr/bin/env node
/**
 * Ensure every package has a .env.example; refresh root .env.example package index.
 *
 * Usage: node tools/hdc/scripts/ensure-package-env-examples.mjs [--write] [--force]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureAllPackageEnvExamples,
  refreshRootEnvExampleIndex,
} from "../lib/ensure-package-env-examples.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(scriptDir, "../../..");

function main() {
  const write = process.argv.includes("--write");
  const force = process.argv.includes("--force");
  const dryRun = !write;

  const { packages, created, skipped } = ensureAllPackageEnvExamples(publicRoot, {
    dryRun,
    force,
  });
  const index = refreshRootEnvExampleIndex(publicRoot, { dryRun });

  console.error(`Packages: ${packages.length}`);
  console.error(`${dryRun ? "Would create" : "Created"}: ${created.length}`);
  console.error(`Skipped (existing): ${skipped.length}`);
  console.error(
    `${dryRun ? "Would refresh" : "Refreshed"} root .env.example index (${index.packageCount} packages)`,
  );

  if (dryRun) {
    console.error("Dry run — pass --write to update files");
    if (created.length) {
      console.error("New .env.example:");
      for (const rel of created) console.error(`  ${rel}`);
    }
  }
}

main();
