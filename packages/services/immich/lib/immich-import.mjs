import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { writeResolvedRepoJson } from "../../../../tools/hdc/lib/private-repo.mjs";
import { sanitizeSystemConfigForStorage } from "./immich-admin-config.mjs";

const PACKAGE_CONFIG_EXAMPLE = "packages/services/immich/config.example.json";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {unknown} opts.live
 * @param {(line: string) => void} [opts.log]
 */
export function importImmichAdminToConfig(opts) {
  const log = opts.log ?? (() => {});
  const { data: cfgRaw, resolved, source } = loadPackageConfigFromPackageRoot(opts.packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });

  const sanitized = sanitizeSystemConfigForStorage(opts.live);
  if (!sanitized) {
    throw new Error("live system-config is empty or invalid");
  }

  const defaults = isObject(cfgRaw.defaults) ? { ...cfgRaw.defaults } : {};
  const immich = isObject(defaults.immich) ? { ...defaults.immich } : {};
  immich.system_config = sanitized;
  defaults.immich = immich;

  const next = {
    ...cfgRaw,
    defaults,
  };

  writeResolvedRepoJson(resolved, next);
  log(`Wrote sanitized system_config to config (${source}: ${resolved.rel}).`);

  return {
    config_rel: resolved.rel,
    section_count: Object.keys(sanitized).length,
  };
}
