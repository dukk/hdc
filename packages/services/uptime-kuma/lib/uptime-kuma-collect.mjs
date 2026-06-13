import {
  liveMonitorRowToConfig,
  monitorHasDrift,
  parseUptimeKumaId,
} from "./uptime-kuma-config.mjs";

/**
 * @typedef {import('./uptime-kuma-config.mjs').ConfigMonitor} ConfigMonitor
 */

/**
 * @param {ReturnType<import('./uptime-kuma-api.mjs').createUptimeKumaClient>} client
 * @param {(line: string) => void} [log]
 */
export async function fetchLiveUptimeKumaMonitors(client, log = () => {}) {
  await client.login();
  log("connected to Uptime Kuma API (socket.io)");
  const rows = await client.getMonitorList();
  log(`live monitors: ${rows.length}`);

  /** @type {ConfigMonitor[]} */
  const monitors = [];
  for (const row of rows) {
    const mapped = liveMonitorRowToConfig(row);
    if (mapped) monitors.push(mapped);
  }

  monitors.sort((a, b) => a.name.localeCompare(b.name));

  return {
    monitors,
    raw: { monitorRows: rows },
  };
}

/**
 * @param {ReturnType<import('./uptime-kuma-config.mjs').normalizeUptimeKumaMonitorConfig>} config
 * @param {Awaited<ReturnType<typeof fetchLiveUptimeKumaMonitors>>} live
 */
export function collectUptimeKumaMonitorState(config, live) {
  const liveById = new Map(
    live.monitors.filter((m) => m.uptime_kuma_id != null).map((m) => [m.uptime_kuma_id, m]),
  );
  const configById = config.monitorsByUptimeKumaId;

  /** @type {Record<string, unknown>[]} */
  const perMonitor = [];
  let hasDrift = false;

  for (const entry of config.monitors) {
    const liveRow =
      entry.uptime_kuma_id != null ? liveById.get(entry.uptime_kuma_id) ?? null : null;
    const drift = liveRow ? monitorHasDrift(entry, liveRow) : entry.managed;
    if (drift) hasDrift = true;
    perMonitor.push({
      id: entry.id,
      uptime_kuma_id: entry.uptime_kuma_id,
      managed: entry.managed,
      missing_in_live: entry.uptime_kuma_id != null && !liveRow,
      missing_in_config: false,
      drift,
      live: liveRow,
    });
  }

  const configUrIds = new Set(
    config.monitors.map((m) => m.uptime_kuma_id).filter((id) => id != null),
  );
  for (const liveRow of live.monitors) {
    if (liveRow.uptime_kuma_id != null && !configUrIds.has(liveRow.uptime_kuma_id)) {
      hasDrift = true;
      perMonitor.push({
        id: liveRow.id,
        uptime_kuma_id: liveRow.uptime_kuma_id,
        managed: false,
        missing_in_live: false,
        missing_in_config: true,
        drift: true,
        live: liveRow,
      });
    }
  }

  return {
    monitor_count: config.monitors.length,
    live_monitor_count: live.monitors.length,
    has_drift: hasDrift,
    monitors: perMonitor,
  };
}

export { parseUptimeKumaId };
