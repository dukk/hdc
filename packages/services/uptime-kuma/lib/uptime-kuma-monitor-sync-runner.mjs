import { join } from "node:path";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { flagGet } from "../../../lib/parse-argv-flags.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import {
  normalizeUptimeKumaMonitorConfig,
  resolveUptimeKumaApiUrl,
} from "./uptime-kuma-config.mjs";
import { normalizeUptimeKumaStatusPageConfig } from "./uptime-kuma-status-page-config.mjs";
import { normalizeUptimeKumaConfig as normalizeDeployments } from "./deployments.mjs";
import { createUptimeKumaClient } from "./uptime-kuma-api.mjs";
import { fetchLiveUptimeKumaMonitors } from "./uptime-kuma-collect.mjs";
import { fetchLiveUptimeKumaStatusPages } from "./uptime-kuma-status-page-collect.mjs";
import { syncUptimeKumaMonitors } from "./uptime-kuma-monitors-sync.mjs";
import { syncUptimeKumaStatusPages } from "./uptime-kuma-status-pages-sync.mjs";
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
 * @param {ReturnType<typeof createUptimeKumaVaultAccess>} [opts.vaultAccess]
 */
export async function createUptimeKumaClientFromConfig(opts) {
  const monitorCfg = normalizeUptimeKumaMonitorConfig(opts.cfgRaw);
  const apiUrl = resolvePackageApiUrl(opts.packageRoot, opts.cfgRaw);
  const vault = opts.vaultAccess ?? createUptimeKumaVaultAccess();
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
 * @param {ReturnType<typeof createUptimeKumaVaultAccess>} [opts.vaultAccess]
 */
export async function runUptimeKumaMonitorSync(opts) {
  const sync = await runUptimeKumaSync(opts);
  return sync.monitor_sync;
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {Record<string, unknown>} cfgRaw
 * @param {Record<string, string>} flags
 * @param {(line: string) => void} opts.log
 * @param {ReturnType<typeof createUptimeKumaVaultAccess>} [opts.vaultAccess]
 */
export async function runUptimeKumaSync(opts) {
  const monitorFilter = flagGet(opts.flags, "monitor");
  const skipMonitors = opts.flags["skip-monitors"] === "1";
  const skipStatusPages = opts.flags["skip-status-pages"] === "1";
  const dryRun = opts.flags["dry-run"] === "1";
  const prune = opts.flags.prune === "1";

  const monitorCfg = normalizeUptimeKumaMonitorConfig(opts.cfgRaw);
  const statusPageCfg = normalizeUptimeKumaStatusPageConfig(opts.cfgRaw);

  /** @type {Record<string, unknown>} */
  let monitorSync = { ok: true, skipped: true, results: [] };
  /** @type {Record<string, unknown>} */
  let statusPageSync = { ok: true, skipped: true, results: [] };

  const needsClient =
    (!skipMonitors && monitorCfg.monitors.length > 0) ||
    (!skipStatusPages && statusPageCfg.status_pages.length > 0);

  if (!needsClient) {
    if (skipMonitors) opts.log("skip monitors (--skip-monitors)");
    else if (!monitorCfg.monitors.length) opts.log("no monitors[] in config — skip monitor sync");
    if (skipStatusPages) opts.log("skip status pages (--skip-status-pages)");
    else if (!statusPageCfg.status_pages.length) {
      opts.log("no status_pages[] in config — skip status page sync");
    }
    return { ok: true, monitor_sync: monitorSync, status_page_sync: statusPageSync };
  }

  const { client, apiUrl } = await createUptimeKumaClientFromConfig({
    packageRoot: opts.packageRoot,
    cfgRaw: opts.cfgRaw,
    log: opts.log,
    vaultAccess: opts.vaultAccess,
  });

  try {
    await client.login();

    /** @type {Awaited<ReturnType<typeof fetchLiveUptimeKumaMonitors>> | null} */
    let liveMonitors = null;

    if (!skipMonitors && monitorCfg.monitors.length) {
      liveMonitors = await fetchLiveUptimeKumaMonitors(client, opts.log, { skipLogin: true });
      monitorSync = await syncUptimeKumaMonitors(client, monitorCfg.monitors, liveMonitors, {
        dryRun,
        prune,
        monitorFilter,
        tagCatalog: monitorCfg.tags,
        log: opts.log,
      });
    } else if (skipMonitors) {
      opts.log("skip monitors (--skip-monitors)");
    } else {
      opts.log("no monitors[] in config — skip monitor sync");
    }

    if (!skipStatusPages && statusPageCfg.status_pages.length) {
      if (!liveMonitors) {
        liveMonitors = await fetchLiveUptimeKumaMonitors(client, opts.log, { skipLogin: true });
      }
      const livePages = await fetchLiveUptimeKumaStatusPages(
        client,
        apiUrl,
        liveMonitors.monitors,
        opts.log,
        { skipLogin: true },
      );
      statusPageSync = await syncUptimeKumaStatusPages(
        client,
        statusPageCfg.status_pages,
        livePages,
        monitorCfg.monitors,
        liveMonitors.monitors,
        { dryRun, log: opts.log },
      );
    } else if (skipStatusPages) {
      opts.log("skip status pages (--skip-status-pages)");
    } else {
      opts.log("no status_pages[] in config — skip status page sync");
    }

    const ok = monitorSync.ok !== false && statusPageSync.ok !== false;
    return { ok, monitor_sync: monitorSync, status_page_sync: statusPageSync };
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
