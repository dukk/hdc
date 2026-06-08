#!/usr/bin/env node
/**
 * Azure Entra query: discover app registrations and diff vs config (JSON on stdout).
 *
 * Usage: hdc run infrastructure azure-entra query -- [--app <config-id>]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { collectAzureEntraState } from "../lib/azure-entra-collect.mjs";
import { createAzureEntraRunContext, PACKAGE_CONFIG_EXAMPLE } from "../lib/azure-entra-run-context.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const packageRoot = join(here, "..");

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[azure-entra] ${line}\n`);
}

async function main() {
  log(`${verb}: starting`);
  const flags = parseArgvFlags(process.argv.slice(2));
  const appId = flagGet(flags, "app");

  const { data: cfgRaw, source } = loadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const { config, api, tenantId } = await createAzureEntraRunContext(cfgRaw);
  log(`tenant ${tenantId}: fetching applications from Microsoft Graph`);

  const state = await collectAzureEntraState({
    config,
    api,
    appFilterId: appId,
  });

  const ok =
    state.configured_missing.length === 0 &&
    !state.managed_applications.some((m) => m.drift);

  const payload = {
    ok,
    verb: "query",
    package: "azure-entra",
    config_source: source,
    tenant_id: tenantId,
    application_filter: config.applicationFilter,
    managed_config_ids: config.managedApplications.map((a) => a.id),
    ...state,
    collected_at: new Date().toISOString(),
  };

  if (state.configured_missing.length) {
    log(
      `warning: managed apps missing in tenant: ${state.configured_missing.map((m) => m.config_id).join(", ")}`
    );
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
