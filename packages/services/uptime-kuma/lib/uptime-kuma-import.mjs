import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { writeResolvedRepoJson } from "../../../../tools/hdc/lib/private-repo.mjs";
import {
  importMonitorsFromHomepage,
  mergeHomepageMonitorsIntoConfig,
} from "./uptime-kuma-homepage-import.mjs";
import { liveMonitorRowToConfig, resolveUptimeKumaApiUrl, slugifyMonitorId } from "./uptime-kuma-config.mjs";
import { normalizeUptimeKumaConfig } from "./deployments.mjs";

export const UPTIME_KUMA_COMPACT_ARRAY_KEYS = ["monitors"];

const PACKAGE_CONFIG_EXAMPLE = "packages/services/uptime-kuma/config.example.json";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Awaited<ReturnType<import('./uptime-kuma-collect.mjs').fetchLiveUptimeKumaMonitors>>} live
 * @param {unknown[]} existingMonitors
 */
export function liveMonitorsToConfigEntries(live, existingMonitors) {
  const existingByUr = new Map(
    (Array.isArray(existingMonitors) ? existingMonitors : [])
      .filter((m) => isObject(m) && Number(m.uptime_kuma_id) > 0)
      .map((m) => [Number(m.uptime_kuma_id), m]),
  );
  const existingById = new Map(
    (Array.isArray(existingMonitors) ? existingMonitors : [])
      .filter((m) => isObject(m) && typeof m.id === "string")
      .map((m) => [String(m.id), m]),
  );
  const usedIds = new Set(existingMonitors.map((m) => (isObject(m) ? String(m.id) : "")).filter(Boolean));

  return live.monitors
    .map((row) => {
      const raw =
        live.raw.monitorRows.find((r) => Number(r.id) === row.uptime_kuma_id) ?? {
          id: row.uptime_kuma_id,
          name: row.name,
          type: row.type,
          url: row.url,
          hostname: row.hostname,
          interval: row.interval,
          ignoreTls: row.ignore_tls,
        };
      const existingByUk =
        row.uptime_kuma_id != null ? existingByUr.get(row.uptime_kuma_id) ?? null : null;
      const existing =
        existingByUk ??
        existingById.get(row.id) ??
        existingById.get(slugifyMonitorId(row.name)) ??
        null;
      if (existing && isObject(existing)) usedIds.add(String(existing.id));
      return liveMonitorRowToConfig(raw, existing && isObject(existing) ? /** @type {import('./uptime-kuma-config.mjs').ConfigMonitor} */ ({
        id: String(existing.id),
        uptime_kuma_id: Number(existing.uptime_kuma_id) || row.uptime_kuma_id,
        name: typeof existing.name === "string" ? existing.name : row.name,
        type: typeof existing.type === "string" ? existing.type : row.type,
        url: typeof existing.url === "string" ? existing.url : row.url,
        hostname: typeof existing.hostname === "string" ? existing.hostname : row.hostname,
        group: typeof existing.group === "string" ? existing.group : row.group,
        interval: Number(existing.interval ?? row.interval) || row.interval,
        ignore_tls: existing.ignore_tls === true ? true : row.ignore_tls,
        managed: existing.managed === true,
        notes: typeof existing.notes === "string" ? existing.notes : row.notes,
      }) : null);
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {Awaited<ReturnType<import('./uptime-kuma-collect.mjs').fetchLiveUptimeKumaMonitors>>} opts.live
 * @param {(line: string) => void} [opts.log]
 */
export function importUptimeKumaMonitorsToConfig(opts) {
  const log = opts.log ?? (() => {});
  const { data: cfgRaw, resolved, source } = loadPackageConfigFromPackageRoot(opts.packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });

  const existingMonitors = Array.isArray(cfgRaw.monitors) ? cfgRaw.monitors : [];
  const monitors = liveMonitorsToConfigEntries(opts.live, existingMonitors);

  const next = {
    ...cfgRaw,
    schema_version: Math.max(Number(cfgRaw.schema_version) || 2, 3),
    monitors,
  };

  writeResolvedRepoJson(resolved, next, { compactArrayKeys: UPTIME_KUMA_COMPACT_ARRAY_KEYS });
  log(`Wrote ${monitors.length} monitor(s) to config (${source}: ${resolved.rel}).`);

  return {
    monitor_count: monitors.length,
    configPath: resolved.path,
    configRel: resolved.rel,
    source,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {string} [opts.repoRoot]
 * @param {(line: string) => void} [opts.log]
 */
export function importHomepageMonitorsToConfig(opts) {
  const log = opts.log ?? (() => {});
  const { data: cfgRaw, resolved, source } = loadPackageConfigFromPackageRoot(opts.packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });

  const { imported } = importMonitorsFromHomepage(opts.repoRoot);
  const existingMonitors = Array.isArray(cfgRaw.monitors) ? cfgRaw.monitors : [];
  const monitors = mergeHomepageMonitorsIntoConfig(imported, existingMonitors);

  const authRaw = isObject(cfgRaw.uptime_kuma_auth) ? cfgRaw.uptime_kuma_auth : {};
  const { defaults, deployments } = normalizeUptimeKumaConfig(cfgRaw);
  const derivedUrl = resolveUptimeKumaApiUrl(cfgRaw, defaults, deployments[0] ?? {});

  const next = {
    ...cfgRaw,
    schema_version: Math.max(Number(cfgRaw.schema_version) || 2, 3),
    uptime_kuma_auth: {
      ...(isObject(authRaw) ? authRaw : {}),
      ...(typeof authRaw.api_url === "string" && authRaw.api_url.trim()
        ? {}
        : derivedUrl
          ? { api_url: derivedUrl }
          : {}),
      username_env:
        typeof authRaw.username_env === "string" && authRaw.username_env.trim()
          ? authRaw.username_env
          : "HDC_UPTIME_KUMA_USERNAME",
      password_vault_key:
        typeof authRaw.password_vault_key === "string" && authRaw.password_vault_key.trim()
          ? authRaw.password_vault_key
          : "HDC_UPTIME_KUMA_PASSWORD",
    },
    monitors,
  };

  writeResolvedRepoJson(resolved, next, { compactArrayKeys: UPTIME_KUMA_COMPACT_ARRAY_KEYS });
  log(`Wrote ${monitors.length} monitor(s) from homepage to config (${source}: ${resolved.rel}).`);

  return {
    monitor_count: monitors.length,
    configPath: resolved.path,
    configRel: resolved.rel,
    source,
  };
}
