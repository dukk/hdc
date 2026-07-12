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
import { repoRoot } from "../../../../apps/hdc-cli/paths.mjs";
import { loadClumpConfigFromClumpRoot, tryLoadClumpConfigFromClumpRoot } from "../../../lib/clump-run-config.mjs";
import { resolveHdcRunnerDeployments } from "../lib/deployments.mjs";
import { listHdcRunnerDeploymentSummaries, queryHdcRunnerLive } from "../lib/query-status.mjs";
import { resolveRunnerConfigureExec } from "../lib/resolve-guest-access.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const clumpRoot = join(here, "..");
const CLUMP_CONFIG_EXAMPLE = "clumps/services/hdc-runner/config.example.json";

const root = repoRoot();
const proxmoxRoot = join(root, "clumps", "infrastructure", "proxmox");

async function main() {
  errout.write(`[hdc] ${target} ${verb}: config summary (JSON on stdout).\n`);
  const flags = parseArgvFlags(process.argv.slice(2));
  const live = flagGet(flags, "live") !== undefined;

  const loaded = tryLoadClumpConfigFromClumpRoot(clumpRoot, {
    exampleRel: CLUMP_CONFIG_EXAMPLE,
  });
  if (!loaded.ok) {
    process.stdout.write(
      JSON.stringify({ ok: false, target, verb, message: "clump config missing" }, null, 2) + "\n",
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
