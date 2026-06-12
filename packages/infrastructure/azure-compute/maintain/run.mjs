#!/usr/bin/env node
/**
 * Azure compute maintain: reconcile tags / ACI definitions; VM resize prompts for cost.
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { confirmDeployCost } from "../../../lib/deploy-cost-confirm.mjs";
import { toAwsCostEstimate } from "../../../lib/cloud-cost-format.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";
import {
  createOperationReportContext,
  recordStep,
  runOperationReportTail,
  setOutcome,
  setStdoutPayload,
} from "../../../lib/operation-report.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { estimateAzureDeploymentCost } from "../lib/azure-cost-estimate.mjs";
import { resolveAzureComputeDeployments } from "../lib/azure-compute-config.mjs";
import {
  createAzureComputeRunContext,
  PACKAGE_CONFIG_EXAMPLE,
} from "../lib/azure-compute-run-context.mjs";
import { azureComputeReportExtraSections } from "../lib/azure-compute-report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const packageRoot = join(here, "..");

function log(line) {
  errout.write(`[azure-compute] ${line}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgvFlags(argv);

  const reportCtx = createOperationReportContext({
    packageId: "azure-compute",
    packageTitle: "Azure compute",
    verb,
    argv,
    manifestNextSteps: ["Run `hdc run infrastructure azure-compute query -- --live`."],
  });

  const { data: cfgRaw, source } = loadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const { config, client } = await createAzureComputeRunContext(cfgRaw);
  const deployments = resolveAzureComputeDeployments(config, flags);

  /** @type {object[]} */
  const results = [];
  let overallOk = true;

  for (const deployment of deployments) {
    const costEstimate = await estimateAzureDeploymentCost(deployment);
    const needsConfirm = deployment.mode === "azure-aci";
    let proceed = true;
    if (needsConfirm && !reportCtx.dryRun) {
      const confirm = await confirmDeployCost({
        estimate: toAwsCostEstimate(costEstimate, deployment.systemId),
        flags,
        log,
      });
      proceed = confirm.proceed;
    }
    if (!proceed) {
      results.push({
        ok: true,
        skipped: true,
        system_id: deployment.systemId,
        cost_estimate: costEstimate,
      });
      continue;
    }
    if (reportCtx.dryRun) {
      results.push({
        ok: true,
        dry_run: true,
        system_id: deployment.systemId,
        cost_estimate: costEstimate,
      });
      recordStep(reportCtx, {
        id: `maintain-${deployment.id}`,
        title: `Maintain ${deployment.systemId}`,
        ran: false,
        skipReason: "dry-run",
        ok: true,
      });
      continue;
    }
    try {
      const out = await client.maintainDeployment(deployment);
      recordStep(reportCtx, {
        id: `maintain-${deployment.id}`,
        title: `Maintain ${deployment.systemId}`,
        ran: true,
        ok: true,
      });
      results.push({ ok: true, system_id: deployment.systemId, cost_estimate: costEstimate, ...out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      overallOk = false;
      results.push({ ok: false, system_id: deployment.systemId, error: msg });
    }
  }

  setOutcome(reportCtx, { ok: overallOk, dryRun: reportCtx.dryRun, exitCode: overallOk ? 0 : 1 });
  setStdoutPayload(reportCtx, { results });
  await runOperationReportTail({
    ctx: reportCtx,
    packageRoot,
    repoRoot: repoRoot(),
    extraSections: azureComputeReportExtraSections,
  });

  console.log(JSON.stringify({ ok: overallOk, results }, null, 2));
  process.exitCode = overallOk ? 0 : 1;
}

main().catch((e) => {
  log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
