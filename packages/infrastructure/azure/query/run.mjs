#!/usr/bin/env node
/**
 * Azure query: discover app registrations and diff vs config (JSON on stdout).
 *
 * Usage: hdc run infrastructure azure query --
 *   [--app <config-id>] [--import] [--yes]
 */
import { createInterface } from "node:readline/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { applicationPassesFilter } from "../lib/azure-config.mjs";
import { collectAzureState } from "../lib/azure-collect.mjs";
import { importAzureToConfig } from "../lib/azure-import.mjs";
import { createAzureRunContext, PACKAGE_CONFIG_EXAMPLE } from "../lib/azure-run-context.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const packageRoot = join(here, "..");

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[azure] ${line}\n`);
}

/**
 * @param {string} question
 */
async function confirm(question) {
  const rl = createInterface({ input, output: errout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(String(answer).trim());
  } finally {
    rl.close();
  }
}

async function main() {
  log(`${verb}: starting`);
  const flags = parseArgvFlags(process.argv.slice(2));
  const appId = flagGet(flags, "app");
  const doImport = flags.import === "1";
  const yes = flags.yes === "1";

  if (doImport) {
    log("import: will replace applications[] in config.json from live tenant (managed: false).");
  }

  const { data: cfgRaw, source } = loadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const { config, api, tenantId, clientId } = await createAzureRunContext(cfgRaw);
  log(`tenant ${tenantId}, client_id ${clientId}: fetching applications from Microsoft Graph`);

  /** @type {{ application_count: number; config_rel: string } | null} */
  let importResult = null;

  if (doImport) {
    const allApps = await api.listApplications();
    if (!yes) {
      const filteredCount = allApps.filter((a) =>
        applicationPassesFilter(a.displayName, config.applicationFilter)
      ).length;
      const ok = await confirm(
        `Replace applications[] with ${filteredCount} app registration(s) from tenant (excluding hdc automation app)? [y/N] `
      );
      if (!ok) {
        errout.write("[azure] Aborted: import not confirmed (use --yes to skip prompt).\n");
        process.exitCode = 1;
        return;
      }
    }
    const written = importAzureToConfig({
      packageRoot,
      liveApps: allApps,
      applicationFilter: config.applicationFilter,
      log,
    });
    importResult = {
      application_count: written.application_count,
      config_rel: written.configRel,
    };
    log(`import complete: ${written.configRel}`);
  }

  let configForCollect = config;
  if (doImport) {
    const reloaded = loadPackageConfigFromPackageRoot(packageRoot, {
      exampleRel: PACKAGE_CONFIG_EXAMPLE,
      log: () => {},
    });
    configForCollect = (await createAzureRunContext(reloaded.data)).config;
  }

  const state = await collectAzureState({
    config: configForCollect,
    api,
    appFilterId: appId,
  });

  const ok =
    state.configured_missing.length === 0 &&
    !state.managed_applications.some((m) => m.drift);

  const payload = {
    ok,
    verb: "query",
    package: "azure",
    config_source: source,
    tenant_id: tenantId,
    application_filter: configForCollect.applicationFilter,
    managed_config_ids: configForCollect.managedApplications.map((a) => a.id),
    ...state,
    import: importResult,
    collected_at: new Date().toISOString(),
    summary:
      "Entra app registration snapshot. Use --import --yes to bootstrap hdc-private applications[].",
  };

  if (state.configured_missing.length) {
    log(
      `warning: managed apps missing in tenant: ${state.configured_missing.map((m) => m.config_id).join(", ")}`
    );
  }
  if (!ok && !doImport) {
    log("warning: live tenant differs from config (run with --import --yes to refresh)");
  }
  log(
    `done: ${state.filtered_application_count} apps in scan (${state.unmanaged_applications.length} unmanaged, ${state.configured_missing.length} missing)`
  );

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((e) => {
  log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
