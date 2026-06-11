import { join } from "node:path";
import { tryLoadPackageConfigFromPackageRoot } from "../../tools/hdc/lib/package-config.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Read pinned Wazuh manager release from the wazuh service package config.
 *
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function resolveWazuhManagerRelease(repoRoot) {
  if (!repoRoot) return "";
  const wazuhRoot = join(repoRoot, "packages", "services", "wazuh");
  const loaded = tryLoadPackageConfigFromPackageRoot(wazuhRoot, {
    exampleRel: "packages/services/wazuh/config.example.json",
  });
  if (!loaded?.data || !isObject(loaded.data)) return "";
  const defaults = isObject(loaded.data.defaults) ? loaded.data.defaults : {};
  const wazuh = isObject(defaults.wazuh) ? defaults.wazuh : {};
  const release = typeof wazuh.release === "string" ? wazuh.release.trim() : "";
  return release;
}
