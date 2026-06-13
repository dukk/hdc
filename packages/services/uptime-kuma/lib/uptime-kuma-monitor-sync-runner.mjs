import { join } from "node:path";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { flagGet } from "../../../lib/parse-argv-flags.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import {
  normalizeUptimeKumaMonitorConfig,
  resolveUptimeKumaApiUrl,
} from "./uptime-kuma-config.mjs";
import { normalizeUptimeKumaConfig as normalizeDeployments } from "./deployments.mjs";
import { createUptimeKumaClient } from "./uptime-kuma-api.mjs";
import { fetchLiveUptimeKumaMonitors } from "./uptime-kuma-collect.mjs";
import { syncUptimeKumaMonitors } from "./uptime-kuma-monitors-sync.mjs";
import {
  createUptimeKumaVaultAccess,
  resolveUptimeKumaCredentials,
} from "./vault-deps.mjs";

const PACKAGE_CONFIG_EXAMPLE = "packages/services/uptime-kuma/config.example.json";

/**
 * @param {string} packageRoot
 * @param {Record<string, unknown>} cfgRaw
 */
export function resolvePackageApiUrl(packageRoot, cfgRaw) {
  const monitorCfg = normalizeUptimeKumaMonitorConfig(cfgRaw);
  if (monitorCfg.apiUrl) return monitorCfg.apiUrl.replace(/\/$/, "");

  const { defaults, deployments } = normalizeDeployments(cfgRaw);
  const deployment = deployments[0] ?? {};
  const url = resolveUptimeKumaApiUrl(cfgRaw, defaults, deployment);
  if (!url) {
    throw new Error(
      "uptime_kuma_auth.api_url is not set and could not derive URL from deployment (set api_url or proxmox.lxc.ip_config)",
    );
  }
  return url;
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {Record<string, unknown>} cfgRaw
 * @param {(line: string) => void} opts.log
 */
export async function createUptimeKumaClientFromConfig(opts) {
  const monitorCfg = normalizeUptimeKumaMonitorConfig(opts.cfgRaw);
  const apiUrl = resolvePackageApiUrl(opts.packageRoot, opts.cfgRaw);
  const vault = createUptimeKumaVaultAccess();
  const creds = await resolveUptimeKumaCredentials(vault, {
    usernameEnv: monitorCfg.usernameEnv,
    passwordVaultKey: monitorCfg.passwordVaultKey,
  });
  opts.log(`API URL ${apiUrl}; username from ${creds.usernameEnv}`);
  const client = createUptimeKumaClient(apiUrl, {
    username: creds.username,
    password: creds.password,
  });
  return { client, apiUrl, monitorCfg, vault };
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {Record<string, unknown>} cfgRaw
 * @param {Record<string, string>} flags
 * @param {(line: string) => void} opts.log
 */
export async function runUptimeKumaMonitorSync(opts) {
  const monitorFilter = flagGet(opts.flags, "monitor");
  const skipMonitors = opts.flags["skip-monitors"] === "1";
  const dryRun = opts.flags["dry-run"] === "1";
  const prune = opts.flags.prune === "1";

  if (skipMonitors) {
    opts.log("skip monitors (--skip-monitors)");
    return { ok: true, skipped: true, results: [] };
  }

  const monitorCfg = normalizeUptimeKumaMonitorConfig(opts.cfgRaw);
  if (!monitorCfg.monitors.length) {
    opts.log("no monitors[] in config — skip monitor sync");
    return { ok: true, skipped: true, results: [] };
  }

  const { client } = await createUptimeKumaClientFromConfig({
    packageRoot: opts.packageRoot,
    cfgRaw: opts.cfgRaw,
    log: opts.log,
  });

  try {
    const live = await fetchLiveUptimeKumaMonitors(client, opts.log);
    const sync = await syncUptimeKumaMonitors(client, monitorCfg.monitors, live, {
      dryRun,
      prune,
      monitorFilter,
      log: opts.log,
    });
    return sync;
  } finally {
    await client.disconnect();
  }
}

/**
 * @param {string} packageRoot
 */
export function uptimeKumaPackageRootFromRepo(root = repoRoot()) {
  return join(root, "packages", "services", "uptime-kuma");
}
