#!/usr/bin/env node
/**
 * Query hdc-runner deployment summary; --live probes guest.
 *
 * Usage: hdc run service hdc-runner query -- [--instance a] [--live]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { resolveHdcRunnerDeployments } from "../lib/deployments.mjs";
import { listHdcRunnerDeploymentSummaries, queryHdcRunnerLive } from "../lib/query-status.mjs";
import { resolveRunnerConfigureExec } from "../lib/resolve-guest-access.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/hdc-runner/config.example.json";

const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

async function main() {
  errout.write(`[hdc] ${target} ${verb}: config summary (JSON on stdout).\n`);
  const flags = parseArgvFlags(process.argv.slice(2));
  const live = flagGet(flags, "live") !== undefined;

  const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
  });
  if (!loaded.found) {
    process.stdout.write(
      JSON.stringify({ ok: false, target, verb, message: "package config missing" }, null, 2) + "\n",
    );
    process.exitCode = 1;
    return;
  }

  const cfg = loaded.data;
  /** @type {Record<string, unknown>} */
  const payload = {
    ok: true,
    target,
    verb,
    config_source: loaded.source,
    summaries: listHdcRunnerDeploymentSummaries(cfg),
  };

  if (live) {
    const deployments = resolveHdcRunnerDeployments(cfg, flags);
    /** @type {Record<string, unknown>[]} */
    const liveResults = [];
    for (const d of deployments) {
      try {
        const exec = resolveRunnerConfigureExec(d, proxmoxRoot);
        liveResults.push({
          system_id: d.systemId,
          ...(await queryHdcRunnerLive(exec, d.runner)),
        });
      } catch (e) {
        liveResults.push({
          system_id: d.systemId,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    payload.live = liveResults;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${e instanceof Error ? e.message : e}\n`);
  process.exitCode = 1;
});
