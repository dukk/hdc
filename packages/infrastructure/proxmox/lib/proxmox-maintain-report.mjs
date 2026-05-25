import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  CRIT_PCT,
  WARN_PCT,
  formatBytes,
  formatGuestLine,
  formatHostLoadSummary,
} from "./proxmox-host-load-report.mjs";

/**
 * @typedef {object} MaintainStepRecord
 * @property {string} id
 * @property {string} title
 * @property {boolean} ran
 * @property {string} [skipReason]
 * @property {boolean | null} ok
 * @property {string[]} notes
 */

/**
 * @typedef {object} MaintainReportContext
 * @property {string} collectedAt
 * @property {boolean} dryRun
 * @property {Record<string, boolean | string>} flags
 * @property {MaintainStepRecord[]} steps
 * @property {string[]} warnings
 * @property {import("./proxmox-host-load-report.mjs").CapacityReportData | null} capacity
 * @property {Record<string, unknown>[]} templateChecks
 * @property {string[]} downHosts
 * @property {number | null} exitCode
 * @property {string | null} reportPath
 */

/**
 * @param {string[]} argv
 * @returns {MaintainReportContext}
 */
export function createMaintainReportContext(argv) {
  const dryRun = argv.includes("--dry-run");
  /** @type {Record<string, boolean | string>} */
  const flags = {
    dryRun,
    skipSshKeys: argv.includes("--skip-ssh-keys"),
    skipApiToken: argv.includes("--skip-api-token"),
    skipTemplates: argv.includes("--skip-templates"),
    skipStorage: argv.includes("--skip-storage"),
    skipOsUpdates: argv.includes("--skip-os-updates"),
    skipLoadReport: argv.includes("--skip-load-report"),
    skipBootstrap: argv.includes("--skip-bootstrap"),
    noDownload: argv.includes("--no-download"),
    noBuildQemu: argv.includes("--no-build-qemu"),
    noPrune: argv.includes("--no-prune"),
    noReport: argv.includes("--no-report"),
  };
  const reportIdx = argv.indexOf("--report");
  if (reportIdx >= 0 && argv[reportIdx + 1]) {
    flags.reportPath = argv[reportIdx + 1];
  }

  return {
    collectedAt: new Date().toISOString(),
    dryRun,
    flags,
    steps: [],
    warnings: [],
    capacity: null,
    templateChecks: [],
    downHosts: [],
    exitCode: null,
    reportPath: null,
  };
}

/**
 * @param {MaintainReportContext} ctx
 * @param {object} step
 * @param {string} step.id
 * @param {string} step.title
 * @param {boolean} step.ran
 * @param {string} [step.skipReason]
 * @param {boolean | null} [step.ok]
 * @param {string[]} [step.notes]
 */
export function recordStep(ctx, step) {
  ctx.steps.push({
    id: step.id,
    title: step.title,
    ran: step.ran,
    skipReason: step.skipReason,
    ok: step.ok ?? null,
    notes: step.notes ?? [],
  });
}

/**
 * @param {MaintainReportContext} ctx
 * @param {string} line
 */
export function pushWarning(ctx, line) {
  if (!ctx.warnings.includes(line)) ctx.warnings.push(line);
}

/**
 * @param {number | null} pct
 * @returns {boolean}
 */
function isWarnPct(pct) {
  return pct !== null && pct >= WARN_PCT;
}

/**
 * @param {number | null} pct
 * @returns {boolean}
 */
function isCritPct(pct) {
  return pct !== null && pct >= CRIT_PCT;
}

/**
 * @param {string} label
 * @param {number | null} pct
 * @param {string} detail
 * @returns {string | null}
 */
function alertLine(label, pct, detail) {
  if (!isWarnPct(pct)) return null;
  const level = isCritPct(pct) ? "CRITICAL" : "WARNING";
  return `- **${level}** ${label}: ${pct}% used — ${detail}`;
}

/**
 * @param {MaintainReportContext} ctx
 * @returns {string}
 */
export function renderMaintainReportMarkdown(ctx) {
  const lines = [];
  const exitLabel =
    ctx.exitCode === null ? "in progress" : ctx.exitCode === 0 ? "OK" : `failed (exit ${ctx.exitCode})`;

  lines.push("# Proxmox maintain report", "");
  lines.push(`- **Collected:** ${ctx.collectedAt}`);
  lines.push(`- **Outcome:** ${exitLabel}`);
  lines.push(`- **Dry run:** ${ctx.dryRun ? "yes" : "no"}`);
  if (ctx.reportPath) lines.push(`- **Report file:** ${ctx.reportPath}`);
  lines.push("");

  lines.push(
    "Guest `maxdisk` sums can exceed shared pool totals; storage pool percentages below reflect **actual** Proxmox `used/total`, not guest allocation limits alone.",
    "",
  );

  lines.push("## Summary flags", "");
  lines.push("| Flag | Value |");
  lines.push("| --- | --- |");
  for (const [k, v] of Object.entries(ctx.flags)) {
    lines.push(`| \`${k}\` | ${String(v)} |`);
  }
  lines.push("");

  lines.push("## Steps executed", "");
  lines.push("| Step | Status | Result | Notes |");
  lines.push("| --- | --- | --- | --- |");
  for (const s of ctx.steps) {
    const status = s.ran ? "ran" : `skipped${s.skipReason ? ` (${s.skipReason})` : ""}`;
    const result =
      !s.ran ? "—" : s.ok === null ? "—" : s.ok ? "ok" : "**fail**";
    const notes = s.notes.length ? s.notes.join("; ") : "—";
    lines.push(`| ${s.title} | ${status} | ${result} | ${notes} |`);
  }
  lines.push("");

  if (ctx.downHosts.length) {
    lines.push("## Hosts marked down in config", "");
    for (const id of ctx.downHosts) {
      lines.push(`- \`${id}\` — excluded from API/SSH iteration`);
    }
    lines.push("");
  }

  if (ctx.warnings.length) {
    lines.push("## Warnings", "");
    for (const w of ctx.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  const cap = ctx.capacity;
  if (cap?.clusters.length) {
    lines.push("## Configured guest allocation", "");
    for (const cluster of cap.clusters) {
      lines.push(`### Cluster ${cluster.id}`, "");
      for (const host of cluster.hosts) {
        lines.push(`#### Host ${host.id} (\`${host.pveNode}\`)`, "");
        lines.push(`Guests: ${host.guests.length}`, "");
        if (host.guests.length) {
          lines.push("");
          lines.push("| vmid | name | type | vCPU | RAM | disk |");
          lines.push("| ---: | --- | --- | ---: | --- | --- |");
          for (const g of host.guests) {
            lines.push(
              `| ${g.vmid} | ${g.name} | ${g.type} | ${g.maxcpu} | ${formatBytes(g.maxmem)} | ${formatBytes(g.maxdisk)} |`,
            );
          }
          lines.push("");
        }
        const cpuPct = host.loadPercent.cpu;
        const memPct = host.loadPercent.mem;
        const diskPct = host.loadPercent.disk;
        const cpuStr =
          cpuPct === null
            ? `${host.totals.maxcpu} vCPU allocated (host CPUs unknown)`
            : `${host.totals.maxcpu}/${host.capacity.cpuCount} vCPU (${cpuPct}%)`;
        const memStr =
          memPct === null
            ? `${formatBytes(host.totals.maxmem)} allocated`
            : `${formatBytes(host.totals.maxmem)} / ${formatBytes(host.capacity.memoryBytes)} (${memPct}%)`;
        const diskStr =
          diskPct === null
            ? `${formatBytes(host.totals.maxdisk)} guest maxdisk sum`
            : `${formatBytes(host.totals.maxdisk)} / ${formatBytes(host.storageCapacityBytes)} configured (${diskPct}%)`;
        lines.push(`**Configured load:** CPU ${cpuStr}; RAM ${memStr}; disk ${diskStr}`, "");
      }
    }
  } else if (!ctx.flags.skipLoadReport && !ctx.flags.noReport) {
    lines.push("## Configured guest allocation", "");
    lines.push("_No capacity data collected (API auth or config missing)._", "");
  }

  if (cap?.clusters.length) {
    lines.push("## Storage and disk usage", "");
    for (const cluster of cap.clusters) {
      lines.push(`### Cluster ${cluster.id}`, "");
      for (const host of cluster.hosts) {
        lines.push(`#### Host ${host.id} (\`${host.pveNode}\`)`, "");
        if (host.rootfs) {
          const r = host.rootfs;
          lines.push(
            `**Root filesystem:** ${formatBytes(r.used)} / ${formatBytes(r.total)} used (${r.usedPercent ?? "?"}%) — ${r.headroom}`,
            "",
          );
        } else {
          lines.push("**Root filesystem:** _status unavailable_", "");
        }
        if (host.storagePools.length) {
          lines.push("| Pool | type | total | used | avail | % used | headroom |");
          lines.push("| --- | --- | --- | --- | --- | ---: | --- |");
          for (const p of host.storagePools) {
            lines.push(
              `| ${p.id} | ${p.type || "—"} | ${formatBytes(p.total)} | ${formatBytes(p.used)} | ${formatBytes(p.avail)} | ${p.usedPercent ?? "—"} | ${p.headroom} |`,
            );
          }
          lines.push("");
        } else {
          lines.push("_No storage pools on this node._", "");
        }
      }
    }
  }

  /** @type {string[]} */
  const alerts = [];
  if (cap) {
    for (const cluster of cap.clusters) {
      for (const host of cluster.hosts) {
        if (host.rootfs) {
          const a = alertLine(
            `Root filesystem on ${host.id}`,
            host.rootfs.usedPercent,
            `${formatBytes(host.rootfs.used)} / ${formatBytes(host.rootfs.total)}`,
          );
          if (a) alerts.push(a);
        }
        for (const p of host.storagePools) {
          const a = alertLine(
            `Storage ${p.id} on ${host.id}`,
            p.usedPercent,
            `${formatBytes(p.used)} / ${formatBytes(p.total)}`,
          );
          if (a) alerts.push(a);
        }
        if (isWarnPct(host.loadPercent.cpu)) {
          alerts.push(
            `- **${isCritPct(host.loadPercent.cpu) ? "CRITICAL" : "WARNING"}** Configured vCPU on ${host.id}: ${host.loadPercent.cpu}% of host CPUs`,
          );
        }
        if (isWarnPct(host.loadPercent.mem)) {
          alerts.push(
            `- **${isCritPct(host.loadPercent.mem) ? "CRITICAL" : "WARNING"}** Configured RAM on ${host.id}: ${host.loadPercent.mem}% of host RAM`,
          );
        }
      }
    }
  }

  lines.push("## Alerts", "");
  if (alerts.length) {
    lines.push(...alerts, "");
  } else {
    lines.push("_No pools or root filesystems at or above 85% used._", "");
  }

  if (ctx.templateChecks.length) {
    lines.push("## Template checks", "");
    lines.push("| cluster | kind | ok | detail |");
    lines.push("| --- | --- | --- | --- |");
    for (const c of ctx.templateChecks) {
      const cluster = typeof c.cluster === "string" ? c.cluster : "—";
      const kind = typeof c.kind === "string" ? c.kind : "—";
      const ok = c.ok === true ? "yes" : c.ok === false ? "no" : "—";
      const detail =
        typeof c.volid === "string"
          ? c.volid
          : typeof c.node === "string"
            ? c.node
            : typeof c.vmid === "number"
              ? String(c.vmid)
              : "—";
      lines.push(`| ${cluster} | ${kind} | ${ok} | ${detail} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

/**
 * @param {string} packageRoot
 * @param {string} [reportPathArg]
 * @returns {string}
 */
export function defaultMaintainReportPath(packageRoot, reportPathArg) {
  if (reportPathArg?.trim()) {
    const p = reportPathArg.trim();
    return isAbsolute(p) ? p : resolve(process.cwd(), p);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return join(packageRoot, "reports", `maintain-${ts}.md`);
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {MaintainReportContext} opts.ctx
 * @param {string} [opts.reportPathArg]
 * @returns {string | null} written path, or null if skipped
 */
export function writeMaintainReportFile(opts) {
  const { packageRoot, ctx, reportPathArg } = opts;
  if (ctx.flags.noReport) return null;

  const outPath = defaultMaintainReportPath(packageRoot, reportPathArg);
  ctx.reportPath = outPath;
  const markdown = renderMaintainReportMarkdown(ctx);
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, markdown, "utf8");
  return outPath;
}

/**
 * Append stderr-style guest lines for debugging (optional export for tests).
 * @param {import("./proxmox-host-load-report.mjs").HostCapacityReport} host
 * @returns {string[]}
 */
export function hostCapacityLogLines(host) {
  const lines = [];
  for (const g of host.guests) {
    lines.push(formatGuestLine(g));
  }
  lines.push(
    formatHostLoadSummary({
      totals: host.totals,
      capacity: host.capacity,
      storageCapacityBytes: host.storageCapacityBytes,
    }),
  );
  return lines;
}
