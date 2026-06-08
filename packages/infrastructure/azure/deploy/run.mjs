#!/usr/bin/env node
/**
 * Azure deploy: create managed app registrations missing from the tenant.
 *
 * Usage: hdc run infrastructure azure deploy --
 *   [--app <config-id>] [--dry-run] [--no-report] [--report <path>]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  createOperationReportContext,
  recordStep,
  runOperationReportTail,
  setOutcome,
  setStdoutPayload,
  pushWarning,
} from "../../../lib/operation-report.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { applicationPassesFilter } from "../lib/azure-config.mjs";
import { createAzureRunContext, findLiveGraphAppForConfig, PACKAGE_CONFIG_EXAMPLE } from "../lib/azure-run-context.mjs";
import { applyAppSync, planAppSync } from "../lib/azure-sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const packageRoot = join(here, "..");

const MANIFEST_NEXT_STEPS = [
  "Run `hdc run infrastructure azure query --` to verify client IDs and drift.",
  "Grant admin consent in Entra portal when required_resource_access changes.",
];

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[azure] ${line}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgvFlags(argv);
  const appFilter = flagGet(flags, "app");

  const reportCtx = createOperationReportContext({
    packageId: "azure",
    packageTitle: "Azure app registrations",
    verb,
    argv,
    manifestNextSteps: MANIFEST_NEXT_STEPS,
  });

  log(`${verb}: starting${reportCtx.dryRun ? " (dry-run)" : ""}`);

  const { data: cfgRaw, source } = loadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const { config, api } = await createAzureRunContext(cfgRaw);
  log("vault: HDC_AZURE_CLIENT_SECRET loaded");

  const allLive = await api.listApplications();
  const filteredLive = allLive.filter((a) =>
    applicationPassesFilter(a.displayName, config.applicationFilter)
  );

  let appsToDeploy = config.managedApplications;
  if (appFilter) {
    const one = config.applicationsById.get(appFilter);
    if (!one) throw new Error(`Application not in config applications[]: ${appFilter}`);
    if (!one.managed) throw new Error(`Application is not managed: ${appFilter}`);
    appsToDeploy = [one];
  }

  if (!appsToDeploy.length) {
    pushWarning(reportCtx, "No managed applications in config");
  }

  let overallOk = true;
  /** @type {object[]} */
  const results = [];

  for (const cfgApp of appsToDeploy) {
    const live = findLiveGraphAppForConfig(cfgApp, filteredLive);
    const plan = planAppSync({ configApp: cfgApp, live });

    if (plan.action !== "create") {
      log(`app ${cfgApp.id}: skip (${plan.action})`);
      recordStep(reportCtx, {
        id: `app-${cfgApp.id}`,
        title: `Deploy: ${cfgApp.display_name}`,
        ran: false,
        skipReason: plan.action,
        ok: true,
        notes: [live ? `client_id=${live.appId}` : "already exists or unchanged"],
      });
      results.push({ config_id: cfgApp.id, action: "skip", reason: plan.action });
      continue;
    }

    log(`app ${cfgApp.id}: planning create`);
    const applyResult = await applyAppSync(api, plan, {
      dryRun: reportCtx.dryRun,
      log,
    });

    recordStep(reportCtx, {
      id: `app-${cfgApp.id}`,
      title: `Deploy: ${cfgApp.display_name}`,
      ran: true,
      ok: applyResult.ok,
      notes: applyResult.clientId ? [`client_id=${applyResult.clientId}`] : [],
    });

    results.push({
      config_id: cfgApp.id,
      action: applyResult.action,
      ok: applyResult.ok,
      client_id: applyResult.clientId,
      error: applyResult.error,
    });

    if (!applyResult.ok) overallOk = false;
  }

  setOutcome(reportCtx, { ok: overallOk, dryRun: reportCtx.dryRun, exitCode: overallOk ? 0 : 1 });
  setStdoutPayload(reportCtx, { deploy_results: results });

  await runOperationReportTail({
    ctx: reportCtx,
    packageRoot,
    repoRoot: repoRoot(),
  });

  log(overallOk ? `${verb}: completed successfully` : `${verb}: completed with errors`);
  process.exitCode = overallOk ? 0 : 1;
}

main().catch(async (e) => {
  log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
