import { join } from "node:path";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { flagGet } from "../../../lib/parse-argv-flags.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import {
  normalizeUptimeKumaMonitorConfig,
  resolveUptimeKumaApiUrl,
} from "./uptime-kuma-config.mjs";
import { normalizeUptimeKumaStatusPageConfig } from "./uptime-kuma-status-page-config.mjs";
import {
  normalizeUptimeKumaConfig as normalizeDeployments,
  resolveDeploymentConfigSlicesForSync,
} from "./deployments.mjs";
import { createUptimeKumaClient } from "./uptime-kuma-api.mjs";
import { fetchLiveUptimeKumaMonitors } from "./uptime-kuma-collect.mjs";
import { fetchLiveUptimeKumaStatusPages } from "./uptime-kuma-status-page-collect.mjs";
import { syncUptimeKumaMonitors } from "./uptime-kuma-monitors-sync.mjs";
import { syncUptimeKumaStatusPages } from "./uptime-kuma-status-pages-sync.mjs";
import {
  buildNotificationIdList,
  fetchLiveUptimeKumaNotifications,
  syncUptimeKumaNotifications,
} from "./uptime-kuma-notifications-sync.mjs";
import { normalizeUptimeKumaNotificationsConfig } from "./uptime-kuma-notifications-config.mjs";
import {
  createUptimeKumaVaultAccess,
  resolveUptimeKumaCredentials,
} from "./vault-deps.mjs";
import { withUptimeKumaSshTunnelIfNeeded } from "./uptime-kuma-ssh-tunnel.mjs";

const PACKAGE_CONFIG_EXAMPLE = "packages/services/uptime-kuma/config.example.json";

/**
 * @param {Record<string, unknown>} slice
 * @param {Record<string, unknown>} defaults
 * @param {Record<string, unknown>} deployment
 */
export function resolveSliceApiUrl(slice, defaults, deployment) {
  const monitorCfg = normalizeUptimeKumaMonitorConfig(slice);
  if (monitorCfg.apiUrl) return monitorCfg.apiUrl.replace(/\/$/, "");

  const url = resolveUptimeKumaApiUrl(slice, defaults, {
    ...deployment,
    configure: slice.configure,
    uptime_kuma: slice.uptime_kuma,
  });
  if (!url) {
    throw new Error(
      "uptime_kuma_auth.api_url is not set and could not derive URL from deployment",
    );
  }
  return url;
}

/**
 * @param {string} packageRoot
 * @param {Record<string, unknown>} cfgRaw
 */
export function resolvePackageApiUrl(packageRoot, cfgRaw) {
  const slices = resolveDeploymentConfigSlicesForSync(cfgRaw, {});
  if (!slices.length) {
    throw new Error("no deployments configured for uptime-kuma");
  }
  const first = slices[0];
  return resolveSliceApiUrl(first.slice, first.defaults, first.deployment);
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} slice
 * @param {Record<string, unknown>} defaults
 * @param {Record<string, unknown>} deployment
 * @param {(line: string) => void} opts.log
 * @param {ReturnType<typeof createUptimeKumaVaultAccess>} [opts.vaultAccess]
 */
export async function createUptimeKumaClientFromSlice(opts) {
  const monitorCfg = normalizeUptimeKumaMonitorConfig(opts.slice);
  const apiUrl = resolveSliceApiUrl(opts.slice, opts.defaults, opts.deployment);
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
 * @param {(line: string) => void} opts.log
 * @param {ReturnType<typeof createUptimeKumaVaultAccess>} [opts.vaultAccess]
 */
export async function createUptimeKumaClientFromConfig(opts) {
  const slices = resolveDeploymentConfigSlicesForSync(opts.cfgRaw, {});
  const first = slices[0];
  return createUptimeKumaClientFromSlice({
    slice: first.slice,
    defaults: first.defaults,
    deployment: first.deployment,
    log: opts.log,
    vaultAccess: opts.vaultAccess,
  });
}

/**
 * @param {object} opts
 * @param {string} opts.systemId
 * @param {Record<string, unknown>} slice
 * @param {Record<string, unknown>} defaults
 * @param {Record<string, unknown>} deployment
 * @param {Record<string, string>} flags
 * @param {(line: string) => void} opts.log
 * @param {ReturnType<typeof createUptimeKumaVaultAccess>} opts.vaultAccess
 */
async function runUptimeKumaSyncForDeployment(opts) {
  const monitorFilter = flagGet(opts.flags, "monitor");
  const skipMonitors = opts.flags["skip-monitors"] === "1";
  const skipStatusPages = opts.flags["skip-status-pages"] === "1";
  const skipNotifications = opts.flags["skip-notifications"] === "1";
  const dryRun = opts.flags["dry-run"] === "1";
  const prune = opts.flags.prune === "1";

  const monitorCfg = normalizeUptimeKumaMonitorConfig(opts.slice);
  const statusPageCfg = normalizeUptimeKumaStatusPageConfig(opts.slice);
  const notificationCfg = normalizeUptimeKumaNotificationsConfig(opts.slice);

  /** @type {Record<string, unknown>} */
  let notificationSync = { ok: true, skipped: true, results: [] };
  /** @type {Record<string, unknown>} */
  let monitorSync = { ok: true, skipped: true, results: [] };
  /** @type {Record<string, unknown>} */
  let statusPageSync = { ok: true, skipped: true, results: [] };

  const needsNotifications = !skipNotifications && notificationCfg.notifications.length > 0;
  const needsMonitors = !skipMonitors && monitorCfg.monitors.length > 0;
  const needsStatusPages = !skipStatusPages && statusPageCfg.status_pages.length > 0;

  if (!needsNotifications && !needsMonitors && !needsStatusPages) {
    opts.log(`${opts.systemId}: nothing to sync`);
    return {
      ok: true,
      system_id: opts.systemId,
      notification_sync: notificationSync,
      monitor_sync: monitorSync,
      status_page_sync: statusPageSync,
    };
  }

  const { client, apiUrl } = await createUptimeKumaClientFromSlice({
    slice: opts.slice,
    defaults: opts.defaults,
    deployment: opts.deployment,
    log: opts.log,
    vaultAccess: opts.vaultAccess,
  });

  return withUptimeKumaSshTunnelIfNeeded(
    {
      apiUrl,
      configure: opts.slice.configure,
      log: opts.log,
    },
    async () => {
      try {
        await client.login();

        /** @type {Map<string, number>} */
        let liveNotificationIds = new Map();

        if (needsNotifications) {
          const liveRows = await fetchLiveUptimeKumaNotifications(client, opts.log);
          notificationSync = await syncUptimeKumaNotifications(
            client,
            notificationCfg.notifications,
            liveRows,
            opts.vaultAccess,
            { dryRun, log: opts.log },
          );
          liveNotificationIds = notificationSync.liveIdsByConfigId ?? new Map();
        } else if (skipNotifications) {
          opts.log("skip notifications (--skip-notifications)");
        }

        const notificationsByMonitor = (entry) =>
          buildNotificationIdList(
            notificationCfg.notifications,
            liveNotificationIds,
            entry.notifications?.length ? entry.notifications : undefined,
          );

        /** @type {Awaited<ReturnType<typeof fetchLiveUptimeKumaMonitors>> | null} */
        let liveMonitors = null;

        if (needsMonitors) {
          liveMonitors = await fetchLiveUptimeKumaMonitors(client, opts.log, { skipLogin: true });
          monitorSync = await syncUptimeKumaMonitors(client, monitorCfg.monitors, liveMonitors, {
            dryRun,
            prune,
            monitorFilter,
            tagCatalog: monitorCfg.tags,
            notificationsByMonitor,
            log: opts.log,
          });
        } else if (skipMonitors) {
          opts.log("skip monitors (--skip-monitors)");
        } else {
          opts.log("no monitors[] in config — skip monitor sync");
        }

        if (needsStatusPages) {
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

        const ok =
          notificationSync.ok !== false &&
          monitorSync.ok !== false &&
          statusPageSync.ok !== false;
        return {
          ok,
          system_id: opts.systemId,
          notification_sync: notificationSync,
          monitor_sync: monitorSync,
          status_page_sync: statusPageSync,
        };
      } finally {
        await client.disconnect();
      }
    },
  );
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
  const vault = opts.vaultAccess ?? createUptimeKumaVaultAccess();
  await vault.unlock({});

  const slices = resolveDeploymentConfigSlicesForSync(opts.cfgRaw, opts.flags);
  if (!slices.length) {
    opts.log("no deployments selected for sync");
    return {
      ok: true,
      notification_sync: { ok: true, skipped: true, results: [] },
      monitor_sync: { ok: true, skipped: true, results: [] },
      status_page_sync: { ok: true, skipped: true, results: [] },
      deployments: [],
    };
  }

  /** @type {Record<string, unknown>[]} */
  const deploymentResults = [];
  for (const entry of slices) {
    opts.log(`sync deployment ${entry.systemId} …`);
    try {
      const result = await runUptimeKumaSyncForDeployment({
        systemId: entry.systemId,
        slice: entry.slice,
        defaults: entry.defaults,
        deployment: entry.deployment,
        flags: opts.flags,
        log: opts.log,
        vaultAccess: vault,
      });
      deploymentResults.push(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      opts.log(`${entry.systemId}: sync failed: ${msg}`);
      deploymentResults.push({
        ok: false,
        system_id: entry.systemId,
        error: msg,
        notification_sync: { ok: false, error: msg, results: [] },
        monitor_sync: { ok: false, error: msg, results: [] },
        status_page_sync: { ok: false, error: msg, results: [] },
      });
    }
  }

  const ok = deploymentResults.every((r) => r.ok !== false);
  const first = deploymentResults[0] ?? {};
  return {
    ok,
    deployments: deploymentResults,
    notification_sync: first.notification_sync ?? null,
    monitor_sync: first.monitor_sync ?? null,
    status_page_sync: first.status_page_sync ?? null,
  };
}

/**
 * @param {string} packageRoot
 */
export function uptimeKumaPackageRootFromRepo(root = repoRoot()) {
  return join(root, "packages", "services", "uptime-kuma");
}
