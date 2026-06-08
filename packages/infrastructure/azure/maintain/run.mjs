#!/usr/bin/env node
/**
 * Azure Entra maintain: reconcile managed app registrations with config.
 *
 * Usage: hdc run infrastructure azure-entra maintain --
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
import { applicationPassesFilter } from "../lib/azure-entra-config.mjs";
import { collectAzureEntraState } from "../lib/azure-entra-collect.mjs";
import { createAzureEntraRunContext, findLiveGraphAppForConfig, PACKAGE_CONFIG_EXAMPLE } from "../lib/azure-entra-run-context.mjs";
import { applyAppSync, planAppSync } from "../lib/azure-entra-sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const packageRoot = join(here, "..");

const MANIFEST_NEXT_STEPS = [
  "Run `hdc run infrastructure azure-entra query --` to verify diffs after maintain.",
  "Grant admin consent in Entra portal when API permissions change.",
];

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[azure-entra] ${line}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgvFlags(argv);
  const appFilter = flagGet(flags, "app");

  const reportCtx = createOperationReportContext({
    packageId: "azure-entra",
    packageTitle: "Azure Entra app registrations",
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

  const { config, api } = await createAzureEntraRunContext(cfgRaw);
  log("vault: HDC_AZURE_CLIENT_SECRET loaded");

  const allLive = await api.listApplications();
  const filteredLive = allLive.filter((a) =>
    applicationPassesFilter(a.displayName, config.applicationFilter)
  );

  let appsToMaintain = config.managedApplications;
  if (appFilter) {
    const one = config.applicationsById.get(appFilter);
    if (!one) throw new Error(`Application not in config applications[]: ${appFilter}`);
    if (!one.managed) throw new Error(`Application is not managed: ${appFilter}`);
    appsToMaintain = [one];
  }

  let overallOk = true;

  for (const cfgApp of appsToMaintain) {
    const live = findLiveGraphAppForConfig(cfgApp, filteredLive);
    if (!live) {
      pushWarning(reportCtx, `Managed app not in tenant (run deploy): ${cfgApp.id}`);
      recordStep(reportCtx, {
        id: `app-${cfgApp.id}`,
        title: `Maintain: ${cfgApp.display_name}`,
        ran: false,
        skipReason: "missing in tenant",
        ok: false,
      });
      overallOk = false;
      continue;
    }

    const plan = planAppSync({ configApp: cfgApp, live });
    log(`app ${cfgApp.id}: plan action=${plan.action}`);

    if (plan.action === "unchanged") {
      recordStep(reportCtx, {
        id: `app-${cfgApp.id}`,
        title: `Maintain: ${cfgApp.display_name}`,
        ran: false,
        skipReason: "unchanged",
        ok: true,
        notes: [`client_id=${live.appId}`],
      });
      continue;
    }

    if (plan.action === "create") {
      pushWarning(reportCtx, `${cfgApp.id}: missing in tenant — run deploy first`);
      recordStep(reportCtx, {
        id: `app-${cfgApp.id}`,
        title: `Maintain: ${cfgApp.display_name}`,
        ran: false,
        skipReason: "needs deploy",
        ok: false,
      });
      overallOk = false;
      continue;
    }

    const applyResult = await applyAppSync(api, plan, {
      dryRun: reportCtx.dryRun,
      log,
    });

    recordStep(reportCtx, {
      id: `app-${cfgApp.id}`,
      title: `Maintain: ${cfgApp.display_name}`,
      ran: true,
      ok: applyResult.ok,
      notes: [
        `client_id=${live.appId}`,
        ...(applyResult.error ? [applyResult.error] : []),
      ],
    });

    if (!applyResult.ok) overallOk = false;
  }

  const snapshot = await collectAzureEntraState({
    config,
    api,
    appFilterId: appFilter,
  });

  if (snapshot.configured_missing.length) {
    for (const m of snapshot.configured_missing) {
      pushWarning(reportCtx, `Managed app missing in tenant: ${m.config_id}`);
    }
    overallOk = false;
  }

  setOutcome(reportCtx, { ok: overallOk, dryRun: reportCtx.dryRun, exitCode: overallOk ? 0 : 1 });
  setStdoutPayload(reportCtx, {
    config_source: source,
    managed_applications: snapshot.managed_applications,
    configured_missing: snapshot.configured_missing,
  });

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
