import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { slugifyOutageKey } from "./monitor-outage-check.mjs";
import {
  loadDispatcherState,
  runHdcCliCapture,
  saveDispatcherState,
  sha256Hex,
} from "./dispatcher.mjs";
import { createTask, listTasks, updateTaskStatus } from "./operations-fs.mjs";

export const MAINTAINER_SCAN_FINGERPRINT_KEY = "maintainer_scan_fingerprint";

/** @typedef {"client"|"guest"|"hypervisor"|"service"|"routine"} MaintenanceRequirementKind */

/**
 * @typedef {{
 *   key: string;
 *   kind: MaintenanceRequirementKind;
 *   label: string;
 *   details: Record<string, unknown>;
 * }} MaintenanceRequirement
 */

/** Weekly client maintain schedule ids (hdc-agents config). */
export const WEEKLY_CLIENT_SCHEDULE_IDS = [
  "client-maintain-weekly-windows",
  "client-maintain-weekly-ubuntu",
  "client-maintain-weekly-raspberrypi",
];

/** @type {{ service: string; queryArgs: string[]; githubRepo?: string; configVersionPath?: string[]; liveVersionPath?: string[] }[]} */
export const SERVICE_VERSION_PROBE_CATALOG = [
  {
    service: "gatus",
    queryArgs: ["run", "service", "gatus", "query", "--", "--live"],
    githubRepo: "TwiN/gatus",
    configVersionPath: ["deployments", "0", "version"],
    liveVersionPath: ["live_results", "0", "version", "installed"],
  },
  {
    service: "solidtime",
    queryArgs: ["run", "service", "solidtime", "query", "--", "--live"],
    githubRepo: "solidtime-io/solidtime",
    configVersionPath: ["deployments", "0", "version"],
    liveVersionPath: ["live_results", "0", "version"],
  },
  {
    service: "homeassistant",
    queryArgs: ["run", "service", "homeassistant", "query", "--", "--live"],
    configVersionPath: ["deployments", "0", "release"],
    liveVersionPath: ["live_results", "0", "version"],
  },
];

const WEEKLY_OVERDUE_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * @param {unknown} root
 * @param {string[]} path
 */
export function getNestedValue(root, path) {
  let cur = root;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    const idx = /^\d+$/.test(key) ? Number(key) : key;
    cur = /** @type {Record<string, unknown> | unknown[]> */ (cur)[idx];
  }
  return cur;
}

/**
 * @param {string} tag
 */
export function normalizeVersionTag(tag) {
  return String(tag ?? "")
    .trim()
    .replace(/^v/i, "")
    .toLowerCase();
}

/**
 * @param {string} a
 * @param {string} b
 */
export function versionLessThan(a, b) {
  const pa = normalizeVersionTag(a).split(/[.+_-]/).filter(Boolean);
  const pb = normalizeVersionTag(b).split(/[.+_-]/).filter(Boolean);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const sa = pa[i] ?? "0";
    const sb = pb[i] ?? "0";
    const na = Number(sa);
    const nb = Number(sb);
    if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === sa && String(nb) === sb) {
      if (na !== nb) return na < nb;
      continue;
    }
    const cmp = sa.localeCompare(sb);
    if (cmp !== 0) return cmp < 0;
  }
  return false;
}

/**
 * @param {MaintenanceRequirement[]} requirements
 */
export function maintenanceScanFingerprint(requirements) {
  if (!requirements.length) return null;
  const keys = requirements.map((r) => r.key).sort();
  return sha256Hex(keys.join("\n"));
}

/**
 * @param {MaintenanceRequirement[]} requirements
 */
export function formatMaintenanceSummaryMarkdown(requirements) {
  if (!requirements.length) {
    return "No maintenance requirements detected by scripted scan.";
  }
  const lines = [
    "## Maintenance scan",
    "",
    `Detected **${requirements.length}** requirement(s):`,
    "",
  ];
  for (const r of requirements) {
    lines.push(`- **${r.label}** (\`${r.kind}\`, key \`${r.key}\`)`);
    const detailParts = Object.entries(r.details)
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
 * @param {string} repo  owner/name
 */
export async function fetchGithubLatestReleaseTag(repo) {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "hdc-maintainer-scan" },
  });
  if (!res.ok) return null;
  const body = /** @type {{ tag_name?: string }} */ (await res.json());
  return typeof body.tag_name === "string" ? body.tag_name.trim() : null;
}

/**
 * @param {unknown} parsed
 * @param {{ service: string; configVersionPath?: string[]; liveVersionPath?: string[]; latest?: string | null }} probe
 * @returns {MaintenanceRequirement | null}
 */
export function upgradeRequirementFromServiceProbe(parsed, probe) {
  const configVersion = probe.configVersionPath
    ? getNestedValue(parsed, probe.configVersionPath)
    : undefined;
  const liveVersion = probe.liveVersionPath
    ? getNestedValue(parsed, probe.liveVersionPath)
    : undefined;
  const current =
    typeof configVersion === "string"
      ? configVersion
      : typeof liveVersion === "string"
        ? liveVersion
        : null;
  const latest = probe.latest ?? null;
  if (!current || !latest) return null;
  if (!versionLessThan(current, latest)) return null;
  const key = `upgrade:${probe.service}:${normalizeVersionTag(latest)}`;
  return {
    key,
    kind: "service",
    label: `${probe.service} upgrade ${current} → ${latest}`,
    details: { service: probe.service, current, latest },
  };
}

/**
 * @param {unknown} parsed
 * @param {"windows"|"ubuntu"|"raspberrypi"} platform
 * @returns {MaintenanceRequirement[]}
 */
export function requirementsFromClientQuery(parsed, platform) {
  /** @type {MaintenanceRequirement[]} */
  const out = [];
  const hosts = Array.isArray(parsed?.hosts) ? parsed.hosts : [];
  for (const row of hosts) {
    if (!row || typeof row !== "object") continue;
    const h = /** @type {Record<string, unknown>} */ (row);
    const hostId = typeof h.host_id === "string" ? h.host_id : typeof h.id === "string" ? h.id : "";
    if (!hostId) continue;
    const slug = slugifyOutageKey(hostId);
    const updates =
      h.updates && typeof h.updates === "object" && !Array.isArray(h.updates)
        ? /** @type {Record<string, unknown>} */ (h.updates)
        : {};
    const maintain =
      h.maintain && typeof h.maintain === "object" && !Array.isArray(h.maintain)
        ? /** @type {Record<string, unknown>} */ (h.maintain)
        : {};

    const rebootRequired =
      h.reboot_required === true || maintain.reboot_required === true || updates.reboot_required === true;
    if (rebootRequired) {
      out.push({
        key: `reboot:client:${platform}:${slug}`,
        kind: "client",
        label: `Reboot required: client ${platform} host ${hostId}`,
        details: { platform, host_id: hostId },
      });
    }

    const pending =
      typeof h.upgradable_count === "number"
        ? h.upgradable_count
        : typeof updates.pending_updates === "number"
          ? updates.pending_updates
          : typeof updates.upgradable_count === "number"
            ? updates.upgradable_count
            : null;
    if (pending != null && pending > 0 && !rebootRequired) {
      out.push({
        key: `pending:client:${platform}:${slug}`,
        kind: "client",
        label: `Pending updates: client ${platform} host ${hostId} (${pending})`,
        details: { platform, host_id: hostId, pending_updates: pending },
      });
    }
  }
  return out;
}

/**
 * @param {unknown} parsed
 * @returns {MaintenanceRequirement[]}
 */
export function requirementsFromProxmoxRebootQuery(parsed) {
  const rows = Array.isArray(parsed?.reboot_required) ? parsed.reboot_required : [];
  /** @type {MaintenanceRequirement[]} */
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const id = typeof r.system_id === "string" ? r.system_id : typeof r.id === "string" ? r.id : "";
    if (!id) continue;
    out.push({
      key: `reboot:guest:${slugifyOutageKey(id)}`,
      kind: "guest",
      label: `Guest reboot pending: ${id}`,
      details: {
        system_id: id,
        vmid: r.vmid ?? null,
        node: r.node ?? null,
      },
    });
  }
  return out;
}

/**
 * @param {unknown} parsed
 * @returns {MaintenanceRequirement[]}
 */
export function requirementsFromProxmoxPendingOsQuery(parsed) {
  const rows = Array.isArray(parsed?.hypervisors) ? parsed.hypervisors : [];
  /** @type {MaintenanceRequirement[]} */
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const id = typeof r.id === "string" ? r.id : "";
    const pending = typeof r.pending_updates === "number" ? r.pending_updates : null;
    const rebootRequired = r.reboot_required === true;
    if (!id) continue;
    if (pending != null && pending > 0) {
      out.push({
        key: `hypervisor-os:${slugifyOutageKey(id)}`,
        kind: "hypervisor",
        label: `Hypervisor OS updates pending: ${id} (${pending} packages)`,
        details: { hypervisor_id: id, pending_updates: pending, reboot_required: rebootRequired },
      });
    } else if (rebootRequired) {
      out.push({
        key: `reboot:hypervisor:${slugifyOutageKey(id)}`,
        kind: "hypervisor",
        label: `Hypervisor reboot pending: ${id}`,
        details: { hypervisor_id: id },
      });
    }
  }
  return out;
}

/**
 * @param {string} metaRoot
 * @param {string[]} scheduleIds
 * @param {number} nowMs
 */
export function weeklyRoutineOverdueRequirements(metaRoot, scheduleIds, nowMs) {
  const logsDir = join(metaRoot, "logs");
  /** @type {MaintenanceRequirement[]} */
  const out = [];
  for (const scheduleId of scheduleIds) {
    const logPath = join(logsDir, `${scheduleId}.log`);
    if (!existsSync(logPath)) {
      out.push({
        key: `routine-overdue:${scheduleId}`,
        kind: "routine",
        label: `Weekly routine never logged: ${scheduleId}`,
        details: { schedule_id: scheduleId, log_path: logPath },
      });
      continue;
    }
    const st = statSync(logPath);
    const ageMs = nowMs - st.mtimeMs;
    if (ageMs > WEEKLY_OVERDUE_MS) {
      out.push({
        key: `routine-overdue:${scheduleId}`,
        kind: "routine",
        label: `Weekly routine overdue: ${scheduleId}`,
        details: {
          schedule_id: scheduleId,
          last_mtime_ms: st.mtimeMs,
          age_days: Math.round(ageMs / (24 * 60 * 60 * 1000)),
        },
      });
      continue;
    }
    const text = readFileSync(logPath, "utf8");
    const lastExit = [...text.matchAll(/exit=(\d+)/g)].pop();
    const exitCode = lastExit ? Number(lastExit[1]) : null;
    if (exitCode !== 0) {
      out.push({
        key: `routine-overdue:${scheduleId}`,
        kind: "routine",
        label: `Weekly routine last run failed: ${scheduleId}`,
        details: { schedule_id: scheduleId, last_exit_code: exitCode },
      });
    }
  }
  return out;
}

/**
 * @param {string} privateRoot
 * @param {MaintenanceRequirement} req
 * @param {{ tasksCreated: string[]; tasksUpdated: string[]; log: (line: string) => void }} audit
 */
function upsertMaintainerTask(privateRoot, req, audit) {
  const open = listTasks(privateRoot).filter((t) => t.status !== "done" && t.status !== "blocked");
  const slug = req.key.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase();

  if (req.kind === "routine") {
    const id = `maintainer-routine-overdue-${slug}`;
    const existing = open.find((t) => t.id === id);
    const scheduleId = String(req.details.schedule_id ?? "");
    const platform = scheduleId.includes("windows")
      ? "windows"
      : scheduleId.includes("ubuntu")
        ? "client-ubuntu"
        : scheduleId.includes("raspberrypi")
          ? "raspberrypi"
          : "client";
    const body = `Weekly client maintain appears overdue or failed.\n\n${JSON.stringify(req.details, null, 2)}`;
    const suggested = [`hdc run client ${platform} maintain --`];
    if (existing) {
      updateTaskStatus(privateRoot, id, {
        title: req.label,
        updated_at: new Date().toISOString(),
        suggested_commands: suggested,
      });
      audit.tasksUpdated.push(id);
      return;
    }
    createTask(privateRoot, {
      id,
      role: "hdc-sre-ops",
      priority: "medium",
      status: "pending",
      needs_decision: false,
      title: req.label,
      evidence: ["operations/reports/maintainer-scan-latest.md"],
      suggested_commands: suggested,
      body,
    });
    audit.tasksCreated.push(id);
    return;
  }

  if (req.kind === "client" && req.key.startsWith("reboot:")) {
    const id = `maintainer-reboot-${slug}`;
    if (open.some((t) => t.id === id)) return;
    const platform = String(req.details.platform ?? "client");
    const hostId = String(req.details.host_id ?? "");
    const cliPlatform =
      platform === "ubuntu" ? "client-ubuntu" : platform === "raspberrypi" ? "raspberrypi" : "windows";
    createTask(privateRoot, {
      id,
      role: "hdc-sre-ops",
      priority: "high",
      status: "pending",
      needs_decision: true,
      title: req.label,
      evidence: ["operations/reports/maintainer-scan-latest.md"],
      suggested_commands: [`hdc run client ${cliPlatform} maintain -- --reboot --host-id ${hostId}`],
      body: `Kernel or OS updates require reboot after approval.\n\n${JSON.stringify(req.details, null, 2)}`,
    });
    audit.tasksCreated.push(id);
    return;
  }

  if (req.kind === "guest" && req.key.startsWith("reboot:")) {
    const id = `maintainer-reboot-${slug}`;
    if (open.some((t) => t.id === id)) return;
    const systemId = String(req.details.system_id ?? "");
    createTask(privateRoot, {
      id,
      role: "hdc-sre-ops",
      priority: "high",
      status: "pending",
      needs_decision: true,
      title: req.label,
      evidence: ["operations/reports/maintainer-scan-latest.md"],
      suggested_commands: [
        `hdc run infrastructure proxmox query -- --guest ${systemId}`,
        `# After approval: reboot guest ${systemId} during maintenance window`,
      ],
      body: `Guest reports /var/run/reboot-required.\n\n${JSON.stringify(req.details, null, 2)}`,
    });
    audit.tasksCreated.push(id);
    return;
  }

  if (req.kind === "hypervisor") {
    const id = req.key.startsWith("reboot:")
      ? `maintainer-reboot-hypervisor-${slug}`
      : `maintainer-hypervisor-os-${slug}`;
    if (open.some((t) => t.id === id)) return;
    createTask(privateRoot, {
      id,
      role: "hdc-sre-ops",
      priority: "high",
      status: "pending",
      needs_decision: true,
      title: req.label,
      evidence: ["operations/reports/maintainer-scan-latest.md"],
      suggested_commands: ["hdc run infrastructure proxmox maintain --"],
      body: `Hypervisor OS maintenance requires operator approval (may reboot).\n\n${JSON.stringify(req.details, null, 2)}`,
    });
    audit.tasksCreated.push(id);
    return;
  }

  if (req.kind === "service" && req.key.startsWith("upgrade:")) {
    const service = String(req.details.service ?? "service");
    const id = `maintainer-upgrade-${slugifyOutageKey(service)}`;
    if (open.some((t) => t.id === id)) return;
    const latest = String(req.details.latest ?? "");
    createTask(privateRoot, {
      id,
      role: "hdc-sre-ops",
      priority: "medium",
      status: "pending",
      needs_decision: true,
      title: req.label,
      evidence: [
        `clumps/services/${service}/config.json`,
        "operations/reports/maintainer-scan-latest.md",
      ],
      suggested_commands: [
        `# Update pinned version in hdc-private clumps/services/${service}/config.json to ${latest}`,
        `hdc run service ${service} maintain --`,
      ],
      body: `New upstream version available. Bump config then maintain after approval.\n\n${JSON.stringify(req.details, null, 2)}`,
    });
    audit.tasksCreated.push(id);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.hdcRoot
 * @param {string} opts.privateRoot
 * @param {number} [opts.nowMs]
 * @param {(line: string) => void} [opts.log]
 * @param {boolean} [opts.dryRun]
 * @param {typeof runHdcCliCapture} [opts.runHdcCliCapture]
 * @param {string} [opts.metaRoot]
 */
export async function runMaintenanceScan(opts) {
  const log = opts.log ?? (() => {});
  const nowMs = opts.nowMs ?? Date.now();
  const state = loadDispatcherState(opts.privateRoot);
  const prevFingerprint = String(state[MAINTAINER_SCAN_FINGERPRINT_KEY] ?? "").trim() || null;
  const metaRoot =
    opts.metaRoot ||
    String(process.env.HDC_AGENTS_META_ROOT || "/opt/hdc-agents-meta").trim() ||
    "/opt/hdc-agents-meta";
  const capture = opts.runHdcCliCapture ?? runHdcCliCapture;

  /** @type {MaintenanceRequirement[]} */
  const requirements = [];

  const clientProbes = [
    { platform: "windows", tier: "client", clump: "windows" },
    { platform: "ubuntu", tier: "client", clump: "client-ubuntu" },
    { platform: "raspberrypi", tier: "client", clump: "raspberrypi" },
  ];

  for (const probe of clientProbes) {
    const r = capture(opts.hdcRoot, ["run", probe.tier, probe.clump, "query", "--"]);
    const parsed = parseProbeJson(r.stdout);
    if (!r.ok) log(`[maintenance-scan] client ${probe.platform} query exit ${r.status ?? "?"}`);
    if (!parsed) {
      log(`[maintenance-scan] client ${probe.platform} query returned no JSON`);
      continue;
    }
    const found = requirementsFromClientQuery(
      parsed,
      /** @type {"windows"|"ubuntu"|"raspberrypi"} */ (probe.platform),
    );
    requirements.push(...found);
    log(`[maintenance-scan] client ${probe.platform}: ${found.length} requirement(s)`);
  }

  requirements.push(...weeklyRoutineOverdueRequirements(metaRoot, WEEKLY_CLIENT_SCHEDULE_IDS, nowMs));

  for (const probe of SERVICE_VERSION_PROBE_CATALOG) {
    const r = capture(opts.hdcRoot, probe.queryArgs);
    const parsed = parseProbeJson(r.stdout);
    if (!parsed) {
      log(`[maintenance-scan] service ${probe.service} query returned no JSON`);
      continue;
    }
    let latest = null;
    if (probe.githubRepo) {
      try {
        latest = await fetchGithubLatestReleaseTag(probe.githubRepo);
      } catch (e) {
        log(
          `[maintenance-scan] GitHub latest for ${probe.service}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    const req = upgradeRequirementFromServiceProbe(parsed, { ...probe, latest });
    if (req) {
      requirements.push(req);
      log(`[maintenance-scan] service ${probe.service}: upgrade ${req.details.current} → ${req.details.latest}`);
    }
  }

  const rebootProbe = capture(opts.hdcRoot, [
    "run",
    "infrastructure",
    "proxmox",
    "query",
    "--",
    "--reboot-required",
  ]);
  const rebootParsed = parseProbeJson(rebootProbe.stdout);
  if (rebootParsed) {
    const guestReboots = requirementsFromProxmoxRebootQuery(rebootParsed);
    requirements.push(...guestReboots);
    log(`[maintenance-scan] proxmox reboot-required: ${guestReboots.length} guest(s)`);
  }

  const osProbe = capture(opts.hdcRoot, [
    "run",
    "infrastructure",
    "proxmox",
    "query",
    "--",
    "--pending-os-updates",
  ]);
  const osParsed = parseProbeJson(osProbe.stdout);
  if (osParsed) {
    const hypervisorReqs = requirementsFromProxmoxPendingOsQuery(osParsed);
    requirements.push(...hypervisorReqs);
    log(`[maintenance-scan] proxmox pending-os: ${hypervisorReqs.length} hypervisor signal(s)`);
  }

  const fingerprint = maintenanceScanFingerprint(requirements);
  const hasRequirements = requirements.length > 0;
  const sameAsLastCycle = Boolean(
    hasRequirements && fingerprint && prevFingerprint && fingerprint === prevFingerprint,
  );
  const shouldInvokeLlm = hasRequirements && !sameAsLastCycle;

  const audit = { tasksCreated: /** @type {string[]} */ ([]), tasksUpdated: /** @type {string[]} */ ([]), log };

  if (!opts.dryRun && hasRequirements) {
    for (const req of requirements) {
      if (req.kind === "client" && req.key.startsWith("pending:")) continue;
      upsertMaintainerTask(opts.privateRoot, req, audit);
    }
  }

  if (!opts.dryRun) {
    if (hasRequirements && fingerprint) {
      state[MAINTAINER_SCAN_FINGERPRINT_KEY] = fingerprint;
    } else {
      delete state[MAINTAINER_SCAN_FINGERPRINT_KEY];
    }
    state.maintainer_scan_checked_ms = nowMs;
    saveDispatcherState(opts.privateRoot, state);
  }

  const summaryMarkdown = formatMaintenanceSummaryMarkdown(requirements);

  return {
    has_requirements: hasRequirements,
    fingerprint,
    previous_fingerprint: prevFingerprint,
    same_as_last_cycle: sameAsLastCycle,
    should_invoke_llm: shouldInvokeLlm,
    summary_markdown: summaryMarkdown,
    requirements,
    tasks_created: audit.tasksCreated,
    tasks_updated: audit.tasksUpdated,
    checked_ms: nowMs,
  };
}
