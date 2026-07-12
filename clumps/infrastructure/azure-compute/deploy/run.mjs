#!/usr/bin/env node
/**
 * Azure compute deploy: VMs and ACI with cost confirmation.
 *
 * Usage: hdc run infrastructure azure-compute deploy --
 *   [--instance a | --system-id virt-azure-compute-a]
 *   [--dry-run] [--yes] [--accept-unknown-cost]
 *   [--skip-existing | --redeploy-existing | --destroy-existing]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { confirmDeployCost } from "../../../lib/deploy-cost-confirm.mjs";
import { toAwsCostEstimate } from "../../../lib/cloud-cost-format.mjs";
import { loadClumpConfigFromClumpRoot } from "../../../lib/clump-run-config.mjs";
import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import {
  createOperationReportContext,
  recordStep,
  runOperationReportTail,
  setOutcome,
  setStdoutPayload,
} from "../../../lib/operation-report.mjs";
import { repoRoot } from "../../../../apps/hdc-cli/paths.mjs";
import { estimateAzureDeploymentCost } from "../lib/azure-cost-estimate.mjs";
import { resolveAzureComputeDeployments } from "../lib/azure-compute-config.mjs";
import { createAzureComputeHostProvisioner } from "../lib/azure-compute-host-provisioner.mjs";
import { promptExistingAzureResourceAction } from "../lib/prompt-existing.mjs";
import {
  createAzureComputeRunContext,
  CLUMP_CONFIG_EXAMPLE,
} from "../lib/azure-compute-run-context.mjs";
import { azureComputeReportExtraSections } from "../lib/azure-compute-report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const clumpRoot = join(here, "..");

const MANIFEST_NEXT_STEPS = [
  "Run `hdc run infrastructure azure-compute query -- --live` to verify resources.",
  "Update inventory access IP for cloud VMs after deploy.",
];

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[azure-compute] ${line}\n`);
}

/**
 * @param {import("../lib/azure-compute-config.mjs").ReturnType<typeof import("../lib/azure-compute-config.mjs").normalizeAzureComputeConfig>["deployments"][number]} deployment
 * @param {Awaited<ReturnType<typeof createAzureComputeRunContext>>["client"]} client
 * @param {Record<string, string>} flags
 * @param {import("../../../lib/operation-report.mjs").OperationReportContext} reportCtx
 */
async function deployOne(deployment, client, creds, flags, reportCtx) {
  const { systemId, mode } = deployment;

  const live = await client.getLiveDeployment(deployment);
  if (live?.exists) {
    const action = await promptExistingAzureResourceAction(
      systemId,
      `${mode} ${deployment.azure.resource_name}`,
      flags,
    );
    if (action === "skip") {
      recordStep(reportCtx, {
        id: `deploy-${deployment.id}`,
        title: `Deploy ${systemId}`,
        ran: false,
        skipReason: "existing resource",
        ok: true,
        notes: [`action=skip`],
      });
      return {
        ok: true,
        skipped: true,
        system_id: systemId,
        mode,
        message: "resource exists; skipped",
      };
    }
    if (action === "destroy") {
      if (!reportCtx.dryRun) await client.deleteDeployment(deployment);
      log(`${systemId}: destroyed existing ${mode} before redeploy`);
    }
  }

  const costEstimate = await estimateAzureDeploymentCost(deployment);
  const awsEstimate = toAwsCostEstimate(costEstimate, systemId);
  recordStep(reportCtx, {
    id: `estimate-${deployment.id}`,
    title: `Cost estimate: ${systemId}`,
    ran: true,
    ok: !costEstimate.unknown,
    notes: [`monthly_usd=${awsEstimate.total_monthly_usd}`],
  });

  const confirm = await confirmDeployCost({
    estimate: awsEstimate,
    flags,
    log,
  });
  recordStep(reportCtx, {
    id: `confirm-${deployment.id}`,
    title: `Cost confirmation: ${systemId}`,
    ran: true,
    ok: confirm.proceed || reportCtx.dryRun,
    notes: [
      reportCtx.dryRun ? "dry-run" : confirm.proceed ? "confirmed" : "declined",
    ],
  });

  if (!confirm.proceed) {
    return {
      ok: true,
      skipped: true,
      system_id: systemId,
      mode,
      cost_estimate: costEstimate,
      cost_confirmed: confirm.confirmed,
      message: reportCtx.dryRun ? "dry-run complete" : "deploy declined",
    };
  }

  const provisioner = createAzureComputeHostProvisioner({
    getToken: creds.getToken,
    subscriptionId: creds.subscriptionId,
    deployment,
  });
  const plog = provisionLogFromConsole(console);

  let provision;
  if (mode === "azure-vm") {
    provision = await provisioner.createVm(plog, { name: deployment.azure.resource_name });
  } else {
    provision = await provisioner.createContainer(plog, { name: deployment.azure.resource_name });
  }

  recordStep(reportCtx, {
    id: `provision-${deployment.id}`,
    title: `Provision ${systemId}`,
    ran: true,
    ok: provision.ok,
    notes: [provision.message ?? ""],
  });

  const details = provision.details && typeof provision.details === "object" ? provision.details : {};
  return {
    ok: provision.ok,
    system_id: systemId,
    mode,
    resource_name: deployment.azure.resource_name,
    resource_group: deployment.azure.resource_group,
    location: deployment.azure.location,
    cost_estimate: costEstimate,
    cost_confirmed: true,
    ...details,
    message: provision.message,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgvFlags(argv);

  const reportCtx = createOperationReportContext({
    clumpId: "azure-compute",
    clumpTitle: "Azure compute",
    verb,
    argv,
    manifestNextSteps: MANIFEST_NEXT_STEPS,
  });

  log(`${verb}: starting${reportCtx.dryRun ? " (dry-run)" : ""}`);

  const { data: cfgRaw, source } = loadClumpConfigFromClumpRoot(clumpRoot, {
    exampleRel: CLUMP_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const { config, creds, client } = await createAzureComputeRunContext(cfgRaw);
  log("vault: HDC_AZURE_COMPUTE_CLIENT_SECRET loaded");

  const deployments = resolveAzureComputeDeployments(config, flags);
  /** @type {object[]} */
  const results = [];
  let overallOk = true;

  for (const deployment of deployments) {
    log(`deployment ${deployment.id} (${deployment.systemId}, ${deployment.mode})`);
    try {
      const result = await deployOne(deployment, client, creds, flags, reportCtx);
      results.push(result);
      if (result.ok === false) overallOk = false;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`deployment ${deployment.id} failed: ${msg}`);
      results.push({ ok: false, system_id: deployment.systemId, error: msg });
      overallOk = false;
    }
  }

  setOutcome(reportCtx, { ok: overallOk, dryRun: reportCtx.dryRun, exitCode: overallOk ? 0 : 1 });
  setStdoutPayload(reportCtx, { results });

  await runOperationReportTail({
    ctx: reportCtx,
    clumpRoot,
    repoRoot: repoRoot(),
    extraSections: azureComputeReportExtraSections,
  });

  log(overallOk ? `${verb}: completed successfully` : `${verb}: completed with errors`);
  console.log(JSON.stringify({ ok: overallOk, results }, null, 2));
  process.exitCode = overallOk ? 0 : 1;
}

main().catch((e) => {
  log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
