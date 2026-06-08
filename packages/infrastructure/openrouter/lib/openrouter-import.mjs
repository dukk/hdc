import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { writeResolvedRepoJson } from "../../../../tools/hdc/lib/private-repo.mjs";
import { liveKeyToConfig } from "./openrouter-config.mjs";

export const OPENROUTER_COMPACT_ARRAY_KEYS = ["api_keys"];

const PACKAGE_CONFIG_EXAMPLE = "packages/infrastructure/openrouter/config.example.json";

/**
 * @param {{ keys: import('./openrouter-api.mjs').OpenrouterApiKeyRow[] }} live
 * @param {Map<string, import('./openrouter-config.mjs').ConfigApiKey>} existingByHash
 * @param {Map<string, import('./openrouter-config.mjs').ConfigApiKey>} existingByName
 */
export function liveStateToApiKeys(live, existingByHash, existingByName) {
  return live.keys
    .map((row) => {
      if (!row.hash && !row.name) return null;
      const existing =
        (row.hash ? existingByHash.get(row.hash) : null) ??
        (row.name ? existingByName.get(row.name) : null) ??
        null;
      return liveKeyToConfig(row, existing);
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {{ keys: import('./openrouter-api.mjs').OpenrouterApiKeyRow[]; credits: import('./openrouter-api.mjs').OpenrouterCredits }} opts.live
 * @param {(line: string) => void} [opts.log]
 */
export function importOpenrouterToConfig(opts) {
  const log = opts.log ?? (() => {});
  const { data: cfgRaw, resolved, source } = loadPackageConfigFromPackageRoot(opts.packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });

  const existingList = Array.isArray(cfgRaw.api_keys) ? cfgRaw.api_keys : [];
  const existingByHash = new Map(
    existingList
      .filter((k) => k && typeof k.openrouter_hash === "string" && k.openrouter_hash.trim())
      .map((k) => [String(k.openrouter_hash).trim(), k])
  );
  const existingByName = new Map(
    existingList
      .filter((k) => k && typeof k.name === "string" && k.name.trim())
      .map((k) => [String(k.name).trim(), k])
  );

  const api_keys = liveStateToApiKeys(opts.live, existingByHash, existingByName);

  const next = {
    ...cfgRaw,
    api_keys,
  };

  writeResolvedRepoJson(resolved, next, { compactArrayKeys: OPENROUTER_COMPACT_ARRAY_KEYS });
  log(`Wrote ${api_keys.length} API key(s) to config (${source}: ${resolved.rel}).`);

  return {
    api_key_count: api_keys.length,
    configRel: resolved.rel,
  };
}
