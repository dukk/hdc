#!/usr/bin/env node
/**
 * Maintain hdc-runner: rsync hdc trees, refresh cron/env, guest baseline.
 *
 * Usage: hdc run service hdc-runner maintain -- [--instance a] [--dry-run] [--skip-sync]
 *        [--skip-clamav] [--prune]
 */
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { resolveHdcRunnerDeployments } from "../lib/deployments.mjs";
import { applyHdcRunnerOnDeployment } from "../lib/hdc-runner-operate.mjs";
import { createHdcRunnerVaultAccess } from "../lib/vault-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/hdc-runner/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

function readCfg() {
  return ensurePackageConfig().data;
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: sync and configure hdc-runner (stderr log; JSON on stdout).\n`);
  const flags = parseArgvFlags(process.argv.slice(2));
  const dryRun = flagGet(flags, "dry-run") !== undefined;

  if (!existsSync(ensurePackageConfig().path)) {
    process.stdout.write(
      JSON.stringify({ ok: false, target, verb, message: "package config missing" }, null, 2) + "\n",
    );
    process.exitCode = 1;
    return;
  }

  const vaultAccess = createHdcRunnerVaultAccess();
  const deployments = resolveHdcRunnerDeployments(readCfg(), flags);
  /** @type {Record<string, unknown>[]} */
  const results = [];

  for (const d of deployments) {
    try {
      results.push(
        await applyHdcRunnerOnDeployment(d, {
          root,
          proxmoxRoot,
          flags,
          vaultAccess,
          runInstall: false,
          dryRun,
        }),
      );
    } catch (e) {
      results.push({
        ok: false,
        system_id: d.systemId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const ok = results.every((r) => r.ok !== false);
  const payload = { ok, target, verb, dry_run: dryRun, deployments: results };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  await runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${e instanceof Error ? e.message : e}\n`);
  process.exitCode = 1;
});
