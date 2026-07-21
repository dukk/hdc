import { loadDispatcherState, runHdcCliCapture, saveDispatcherState, sha256Hex } from "./dispatcher.mjs";

export const MONITOR_OUTAGE_FINGERPRINT_KEY = "monitor_outage_fingerprint";

/**
 * @typedef {{
 *   source: "uptime-kuma" | "homepage" | "proxmox";
 *   key: string;
 *   label: string;
 *   details: Record<string, unknown>;
 * }} MonitorOutageEntry
 */

/**
 * @param {string} slug
 */
export function slugifyOutageKey(slug) {
  return String(slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * @param {MonitorOutageEntry[]} outages
 */
export function outageFingerprint(outages) {
  if (!outages.length) return null;
  const keys = outages.map((o) => o.key).sort();
  return sha256Hex(keys.join("\n"));
}

/**
 * @param {unknown} parsed
 * @returns {MonitorOutageEntry[]}
 */
export function outagesFromUptimeKumaQuery(parsed) {
  const failing = Array.isArray(parsed?.failing) ? parsed.failing : [];
  /** @type {MonitorOutageEntry[]} */
  const out = [];
  for (const row of failing) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const name = typeof r.name === "string" ? r.name : `monitor-${r.monitor_id ?? "unknown"}`;
    const key = `uk:${slugifyOutageKey(String(r.monitor_id ?? name))}`;
    out.push({
      source: "uptime-kuma",
      key,
      label: name,
      details: {
        monitor_id: r.monitor_id ?? null,
        type: r.type ?? null,
        target: r.target ?? null,
        msg: r.msg ?? null,
        ping: r.ping ?? null,
        time: r.time ?? null,
      },
    });
  }
  return out;
}

/**
 * @param {unknown} parsed
 * @returns {MonitorOutageEntry[]}
 */
export function outagesFromHomepageQuery(parsed) {
  const failing = Array.isArray(parsed?.failing) ? parsed.failing : [];
  /** @type {MonitorOutageEntry[]} */
  const out = [];
  for (const row of failing) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const group = typeof r.group === "string" ? r.group : "dashboard";
    const name = typeof r.name === "string" ? r.name : typeof r.kind === "string" ? r.kind : "unknown";
    const kind = typeof r.kind === "string" ? r.kind : "siteMonitor";
    const key =
      kind === "dashboard"
        ? `hp:dashboard:${slugifyOutageKey(String(r.system_id ?? "homepage"))}`
        : `hp:${slugifyOutageKey(`${group}/${name}/${kind}`)}`;
    out.push({
      source: "homepage",
      key,
      label: kind === "dashboard" ? `Homepage dashboard (${r.system_id ?? "homepage"})` : `${group} / ${name}`,
      details: {
        group,
        name,
        kind,
        target: r.target ?? null,
        error: r.error ?? null,
        http_code: r.http_code ?? null,
      },
    });
  }
  return out;
}

/**
 * @param {unknown} parsed
 * @returns {MonitorOutageEntry[]}
 */
export function outagesFromProxmoxQuery(parsed) {
  const failing = Array.isArray(parsed?.failing) ? parsed.failing : [];
  /** @type {MonitorOutageEntry[]} */
  const out = [];
  for (const row of failing) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const id = typeof r.id === "string" ? r.id : "unknown";
    const status = typeof r.status === "string" ? r.status : "unknown";
    out.push({
      source: "proxmox",
      key: `pve:${slugifyOutageKey(id)}:${slugifyOutageKey(status)}`,
      label: `${id} (${status})`,
      details: {
        id,
        kind: r.kind ?? null,
        vmid: r.vmid ?? null,
        name: r.name ?? null,
        type: r.type ?? null,
        node: r.node ?? null,
        message: r.message ?? null,
      },
    });
  }
  return out;
}

/**
 * @param {MonitorOutageEntry[]} outages
 */
export function formatOutageSummaryMarkdown(outages) {
  if (!outages.length) {
    return "No outages detected by scripted pre-check.";
  }
  const lines = ["## Outage pre-check", "", `Detected **${outages.length}** failing target(s):`, ""];
  for (const o of outages) {
    lines.push(`- **${o.label}** (\`${o.source}\`, key \`${o.key}\`)`);
    const detailParts = Object.entries(o.details)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    if (detailParts.length) lines.push(`  - ${detailParts.join("; ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {string} stdout
 */
function parseProbeJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.hdcRoot
 * @param {string} opts.privateRoot
 * @param {number} [opts.nowMs]
 * @param {(line: string) => void} [opts.log]
 * @param {boolean} [opts.dryRun]
 */
export function runMonitorOutageCheck(opts) {
  const log = opts.log ?? (() => {});
  const nowMs = opts.nowMs ?? Date.now();
  const state = loadDispatcherState(opts.privateRoot);
  const prevFingerprint = String(state[MONITOR_OUTAGE_FINGERPRINT_KEY] ?? "").trim() || null;

  /** @type {MonitorOutageEntry[]} */
  const outages = [];

  const probes = [
    {
      label: "uptime-kuma",
      args: ["run", "service", "uptime-kuma", "query", "--", "--failing-only"],
      parse: outagesFromUptimeKumaQuery,
    },
    {
      label: "homepage",
      args: ["run", "service", "homepage", "query", "--", "--failing-only"],
      parse: outagesFromHomepageQuery,
    },
    {
      label: "proxmox",
      args: ["run", "infrastructure", "proxmox", "query", "--", "--failing-only"],
      parse: outagesFromProxmoxQuery,
    },
  ];

  /** @type {Record<string, unknown>[]} */
  const probeMeta = [];

  for (const probe of probes) {
    const r = (opts.runHdcCliCapture ?? runHdcCliCapture)(opts.hdcRoot, probe.args);
    const parsed = parseProbeJson(r.stdout);
    if (!r.ok) {
      log(`[monitor-outage-check] probe ${probe.label} CLI exit ${r.status ?? "?"}`);
    }
    if (!parsed) {
      log(`[monitor-outage-check] probe ${probe.label} returned no JSON`);
      probeMeta.push({ probe: probe.label, ok: false, error: r.stderr || "invalid JSON" });
      continue;
    }
    const found = probe.parse(parsed);
    outages.push(...found);
    probeMeta.push({
      probe: probe.label,
      ok: parsed.ok !== false,
      failing_count: found.length,
    });
    log(`[monitor-outage-check] ${probe.label}: ${found.length} failing`);
  }

  const fingerprint = outageFingerprint(outages);
  const hasOutages = outages.length > 0;
  const sameAsLastCycle = Boolean(hasOutages && fingerprint && prevFingerprint && fingerprint === prevFingerprint);
  const shouldInvokeLlm = hasOutages && !sameAsLastCycle;

  if (!opts.dryRun) {
    if (hasOutages && fingerprint) {
      state[MONITOR_OUTAGE_FINGERPRINT_KEY] = fingerprint;
    } else {
      delete state[MONITOR_OUTAGE_FINGERPRINT_KEY];
    }
    state.monitor_outage_checked_ms = nowMs;
    saveDispatcherState(opts.privateRoot, state);
  }

  const summaryMarkdown = formatOutageSummaryMarkdown(outages);

  return {
    has_outages: hasOutages,
    fingerprint,
    previous_fingerprint: prevFingerprint,
    same_as_last_cycle: sameAsLastCycle,
    should_invoke_llm: shouldInvokeLlm,
    summary_markdown: summaryMarkdown,
    outages,
    probes: probeMeta,
    checked_ms: nowMs,
  };
}
