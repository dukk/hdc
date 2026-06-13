import { monitorHasDrift, monitorToSocketPayload } from "./uptime-kuma-config.mjs";

/**
 * @typedef {import('./uptime-kuma-config.mjs').ConfigMonitor} ConfigMonitor
 */

/**
 * @param {object} opts
 * @param {ConfigMonitor} opts.entry
 * @param {ConfigMonitor | null} opts.live
 */
export function planMonitorSync(opts) {
  const { entry, live } = opts;

  if (!entry.managed) {
    return {
      action: /** @type {"skip"} */ ("skip"),
      id: entry.id,
      uptime_kuma_id: entry.uptime_kuma_id,
      reason: "not managed",
      unchanged: true,
    };
  }

  if (!live) {
    return {
      action: /** @type {"add"} */ ("add"),
      id: entry.id,
      uptime_kuma_id: null,
      unchanged: false,
    };
  }

  if (entry.type !== live.type) {
    return {
      action: /** @type {"type_mismatch"} */ ("type_mismatch"),
      id: entry.id,
      uptime_kuma_id: entry.uptime_kuma_id,
      config_type: entry.type,
      live_type: live.type,
      unchanged: false,
    };
  }

  if (monitorHasDrift(entry, live)) {
    return {
      action: /** @type {"edit"} */ ("edit"),
      id: entry.id,
      uptime_kuma_id: entry.uptime_kuma_id ?? live.uptime_kuma_id,
      unchanged: false,
    };
  }

  return {
    action: /** @type {"unchanged"} */ ("unchanged"),
    id: entry.id,
    uptime_kuma_id: entry.uptime_kuma_id ?? live.uptime_kuma_id,
    unchanged: true,
  };
}

/**
 * @param {ReturnType<import('./uptime-kuma-api.mjs').createUptimeKumaClient>} client
 * @param {ReturnType<typeof planMonitorSync>} plan
 * @param {ConfigMonitor} entry
 * @param {{ dryRun?: boolean; log?: (line: string) => void }} [opts]
 */
export async function applyMonitorSync(client, plan, entry, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const log = opts.log ?? (() => {});

  if (plan.action === "skip") {
    log(`skip monitor ${entry.id} (${plan.reason})`);
    return { ok: true, action: "skip", id: entry.id };
  }

  if (plan.action === "type_mismatch") {
    const msg = `monitor ${entry.id}: type mismatch (config=${plan.config_type}, live=${plan.live_type}); delete and recreate manually`;
    log(`error: ${msg}`);
    return { ok: false, action: "type_mismatch", id: entry.id, error: msg };
  }

  if (plan.action === "unchanged") {
    log(`unchanged monitor ${entry.id}`);
    return { ok: true, action: "unchanged", id: entry.id };
  }

  if (plan.action === "add") {
    try {
      if (dryRun) {
        log(`dry-run: would add monitor ${entry.id} (${entry.name})`);
        return { ok: true, action: "add", id: entry.id, dryRun: true };
      }
      const payload = monitorToSocketPayload(entry, false);
      const resp = await client.addMonitor(payload);
      const newId = resp.monitorID ?? resp.monitorId ?? null;
      log(`added monitor ${entry.id} (uptime_kuma_id=${newId ?? "unknown"})`);
      return { ok: true, action: "add", id: entry.id, uptime_kuma_id: newId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`failed add monitor ${entry.id}: ${msg}`);
      return { ok: false, action: "add", id: entry.id, error: msg };
    }
  }

  if (plan.action === "edit") {
    try {
      if (dryRun) {
        log(`dry-run: would edit monitor ${entry.id}`);
        return { ok: true, action: "edit", id: entry.id, dryRun: true };
      }
      const editEntry = {
        ...entry,
        uptime_kuma_id: entry.uptime_kuma_id ?? plan.uptime_kuma_id,
      };
      const payload = monitorToSocketPayload(editEntry, true);
      await client.editMonitor(payload);
      log(`updated monitor ${entry.id}`);
      return { ok: true, action: "edit", id: entry.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`failed edit monitor ${entry.id}: ${msg}`);
      return { ok: false, action: "edit", id: entry.id, error: msg };
    }
  }

  return { ok: false, action: "unknown", id: entry.id, error: "unknown plan action" };
}

/**
 * @param {object} opts
 * @param {number} opts.uptimeKumaId
 * @param {boolean} opts.managed
 */
export function planMonitorDelete(opts) {
  if (!opts.managed) {
    return {
      action: /** @type {"skip"} */ ("skip"),
      uptime_kuma_id: opts.uptimeKumaId,
      reason: "no managed monitors in config",
    };
  }
  return {
    action: /** @type {"delete"} */ ("delete"),
    uptime_kuma_id: opts.uptimeKumaId,
  };
}

/**
 * @param {ReturnType<import('./uptime-kuma-api.mjs').createUptimeKumaClient>} client
 * @param {ReturnType<typeof planMonitorDelete>} plan
 * @param {{ dryRun?: boolean; log?: (line: string) => void; name?: string }} [opts]
 */
export async function applyMonitorDelete(client, plan, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const log = opts.log ?? (() => {});

  if (plan.action === "skip") {
    return { ok: true, action: "skip", uptime_kuma_id: plan.uptime_kuma_id };
  }

  try {
    if (dryRun) {
      log(`dry-run: would delete monitor uptime_kuma_id=${plan.uptime_kuma_id}`);
      return { ok: true, action: "delete", uptime_kuma_id: plan.uptime_kuma_id, dryRun: true };
    }
    await client.deleteMonitor(plan.uptime_kuma_id);
    log(`deleted monitor uptime_kuma_id=${plan.uptime_kuma_id}${opts.name ? ` (${opts.name})` : ""}`);
    return { ok: true, action: "delete", uptime_kuma_id: plan.uptime_kuma_id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`failed delete monitor ${plan.uptime_kuma_id}: ${msg}`);
    return { ok: false, action: "delete", uptime_kuma_id: plan.uptime_kuma_id, error: msg };
  }
}

/**
 * @param {ReturnType<import('./uptime-kuma-api.mjs').createUptimeKumaClient>} client
 * @param {ConfigMonitor[]} monitors
 * @param {Awaited<ReturnType<import('./uptime-kuma-collect.mjs').fetchLiveUptimeKumaMonitors>>} live
 * @param {{ dryRun?: boolean; prune?: boolean; monitorFilter?: string | null; log?: (line: string) => void }} opts
 */
export async function syncUptimeKumaMonitors(client, monitors, live, opts = {}) {
  const log = opts.log ?? (() => {});
  const dryRun = Boolean(opts.dryRun);
  const prune = Boolean(opts.prune);
  const monitorFilter = opts.monitorFilter ?? null;

  let selected = monitors.filter((m) => m.managed);
  if (monitorFilter) {
    const one = monitors.find((m) => m.id === monitorFilter);
    if (!one) throw new Error(`Monitor id not in config: ${monitorFilter}`);
    if (!one.managed) throw new Error(`Monitor is not managed: ${monitorFilter}`);
    selected = [one];
  }

  const liveByUr = new Map(
    live.monitors.filter((m) => m.uptime_kuma_id != null).map((m) => [m.uptime_kuma_id, m]),
  );
  const liveByName = new Map(live.monitors.map((m) => [m.name.toLowerCase(), m]));

  /** @type {Record<string, unknown>[]} */
  const results = [];

  for (const entry of selected) {
    let liveRow =
      entry.uptime_kuma_id != null ? liveByUr.get(entry.uptime_kuma_id) ?? null : null;
    if (!liveRow) {
      liveRow = liveByName.get(entry.name.toLowerCase()) ?? null;
    }
    const plan = planMonitorSync({ entry, live: liveRow });
    log(`monitor ${entry.id}: plan action=${plan.action}`);
    const result = await applyMonitorSync(client, plan, entry, { dryRun, log });
    results.push(result);
  }

  if (prune) {
    const hasManaged = monitors.some((m) => m.managed);
    const configUrIds = new Set(
      monitors.map((m) => m.uptime_kuma_id).filter((id) => id != null),
    );
    for (const liveRow of live.monitors) {
      if (liveRow.uptime_kuma_id == null || configUrIds.has(liveRow.uptime_kuma_id)) continue;
      const plan = planMonitorDelete({ uptimeKumaId: liveRow.uptime_kuma_id, managed: hasManaged });
      if (plan.action === "skip") continue;
      log(`prune monitor ${liveRow.name} (uptime_kuma_id=${liveRow.uptime_kuma_id})`);
      const result = await applyMonitorDelete(client, plan, {
        dryRun,
        log,
        name: liveRow.name,
      });
      results.push(result);
    }
  }

  const ok = results.every((r) => r.ok !== false);
  return { ok, results };
}
