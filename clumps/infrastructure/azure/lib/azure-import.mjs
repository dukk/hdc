import { stderr as errout } from "node:process";

import { loadClumpConfigFromClumpRoot } from "../../../lib/clump-run-config.mjs";
import { writeResolvedRepoJson } from "../../../../apps/hdc-cli/lib/private-repo.mjs";
import {
  applicationPassesFilter,
  liveAppToNormalized,
  suggestedConfigEntry,
} from "./azure-config.mjs";
import { CLUMP_CONFIG_EXAMPLE } from "./azure-run-context.mjs";
import { resolveAzureClientId } from "./vault-deps.mjs";

export const AZURE_COMPACT_ARRAY_KEYS = ["applications"];

/**
 * @param {import('./azure-graph-api.mjs').GraphApplication[]} liveApps
 * @param {{ mode: string; prefixes: string[] }} applicationFilter
 * @param {string} [automationClientId]
 */
export function liveAppsToConfigEntries(liveApps, applicationFilter, automationClientId) {
  const automationId = automationClientId?.trim().toLowerCase() ?? "";
  const filtered = liveApps.filter((a) => applicationPassesFilter(a.displayName, applicationFilter));
  const skipAutomation = filtered.filter(
    (a) => !automationId || String(a.appId ?? "").trim().toLowerCase() !== automationId
  );

  /** @type {Set<string>} */
  const usedIds = new Set();
  /** @type {Record<string, unknown>[]} */
  const applications = [];

  for (const live of skipAutomation) {
    const norm = liveAppToNormalized(live);
    const entry = suggestedConfigEntry(norm);
    entry.managed = false;

    let id = entry.id;
    if (usedIds.has(id)) {
      id = `${id}-${norm.client_id.slice(0, 8)}`;
      entry.id = id;
    }
    usedIds.add(id);

    applications.push(entry);
  }

  applications.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return applications;
}

/**
 * @param {object} opts
 * @param {string} opts.clumpRoot
 * @param {import('./azure-graph-api.mjs').GraphApplication[]} opts.liveApps
 * @param {{ mode: string; prefixes: string[] }} opts.applicationFilter
 * @param {(line: string) => void} [opts.log]
 */
export function importAzureToConfig(opts) {
  const log = opts.log ?? (() => {});
  const { data: cfgRaw, resolved, source } = loadClumpConfigFromClumpRoot(opts.clumpRoot, {
    exampleRel: CLUMP_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });

  let automationClientId = "";
  try {
    automationClientId = resolveAzureClientId();
  } catch {
    automationClientId = "";
  }

  const applications = liveAppsToConfigEntries(
    opts.liveApps,
    opts.applicationFilter,
    automationClientId
  );

  const azureRaw =
    cfgRaw.azure && typeof cfgRaw.azure === "object"
      ? { ...cfgRaw.azure }
      : cfgRaw.azure_entra && typeof cfgRaw.azure_entra === "object"
        ? { ...cfgRaw.azure_entra }
        : { graph_base_url: "https://graph.microsoft.com/v1.0" };

  const filterRaw =
    cfgRaw.application_filter && typeof cfgRaw.application_filter === "object"
      ? cfgRaw.application_filter
      : { mode: "all", display_name_prefixes: [] };

  const next = {
    ...cfgRaw,
    schema_version: typeof cfgRaw.schema_version === "number" ? cfgRaw.schema_version : 1,
    azure: azureRaw,
    application_filter: filterRaw,
    applications,
  };
  delete next.azure_entra;

  writeResolvedRepoJson(resolved, next, { compactArrayKeys: AZURE_COMPACT_ARRAY_KEYS });
  log(
    `Wrote ${applications.length} application(s) to config (${source}: ${resolved.rel}).`
  );

  return {
    application_count: applications.length,
    configPath: resolved.path,
    configRel: resolved.rel,
    source,
  };
}
