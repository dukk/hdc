#!/usr/bin/env node
/**
 * Azure compute query: config summary and optional live status + cost snapshot.
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { loadClumpConfigFromClumpRoot } from "../../../lib/clump-run-config.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../apps/hdc-cli/paths.mjs";
import { estimateAzureDeploymentCost } from "../lib/azure-cost-estimate.mjs";
import { resolveAzureComputeDeployments } from "../lib/azure-compute-config.mjs";
import {
  createAzureComputeRunContext,
  CLUMP_CONFIG_EXAMPLE,
} from "../lib/azure-compute-run-context.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const clumpRoot = join(here, "..");

function log(line) {
  errout.write(`[azure-compute] query: ${line}\n`);
}

async function main() {
  const flags = parseArgvFlags(process.argv.slice(2));
  const live = flagGet(flags, "live") !== undefined;

  const { data: cfgRaw, source } = loadClumpConfigFromClumpRoot(clumpRoot, {
    exampleRel: CLUMP_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const { config, client } = await createAzureComputeRunContext(cfgRaw);
  const deployments = resolveAzureComputeDeployments(config, flags);

  /** @type {object[]} */
  const results = [];
  for (const deployment of deployments) {
    const cost_estimate = await estimateAzureDeploymentCost(deployment);
    /** @type {Record<string, unknown>} */
    const row = {
      id: deployment.id,
      system_id: deployment.systemId,
      mode: deployment.mode,
      resource_name: deployment.azure.resource_name,
      resource_group: deployment.azure.resource_group,
      location: deployment.azure.location,
      cost_estimate,
    };
    if (live) {
      row.live = await client.getLiveDeployment(deployment);
    }
    results.push(row);
  }

  log(`summarized ${results.length} deployment(s)${live ? " (live)" : ""}`);
  console.log(JSON.stringify({ ok: true, deployments: results }, null, 2));
}

main().catch((e) => {
  log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
