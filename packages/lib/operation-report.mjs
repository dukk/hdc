import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { preferredPackageReportPath } from "../../tools/hdc/lib/private-repo.mjs";
import {
  accessNodesFromSystem,
  loadManualServiceSidecar,
  loadManualSystemSidecar,
  primaryIpFromSystem,
  serviceIdsFromSystem,
} from "./inventory-sidecar.mjs";

const SECRET_KEY_RE =
  /password|secret|token|key|passphrase|credential|authorization/i;

/**
 * @typedef {object} OperationStepRecord
 * @property {string} id
 * @property {string} title
 * @property {boolean} ran
 * @property {string} [skipReason]
 * @property {boolean | null} ok
 * @property {string[]} notes
 */

/**
 * @typedef {object} SystemInventoryContext
 * @property {string} systemId
 * @property {Record<string, unknown> | null} system
 * @property {Record<string, unknown>[]} services
 * @property {string | null} inventoryIp
 * @property {{ name?: string; ip?: string; web_ui?: string; ssh?: string }[]} accessNodes
 */

/**
 * @typedef {object} OperationReportContext
 * @property {string} packageId
 * @property {string} packageTitle
 * @property {string} verb
 * @property {string} collectedAt
 * @property {boolean} dryRun
 * @property {Record<string, boolean | string>} flags
 * @property {OperationStepRecord[]} steps
 * @property {string[]} warnings
 * @property {boolean | null} ok
 * @property {number | null} exitCode
 * @property {Record<string, unknown> | null} stdoutPayload
 * @property {SystemInventoryContext[]} inventory
 * @property {string[]} manifestNextSteps
 * @property {string | null} reportPath
 * @property {string | null} repoRoot
 * @property {string[]} argvFlags
 */

/**
 * @param {string[]} argv
 * @returns {{ noReport: boolean; reportPathArg: string | undefined; dryRun: boolean; argvFlags: string[] }}
 */
export function parseOperationReportArgv(argv) {
  const noReport = argv.includes("--no-report");
  const dryRun = argv.includes("--dry-run");
  const reportIdx = argv.indexOf("--report");
  const reportPathArg =
    reportIdx >= 0 && argv[reportIdx + 1] ? String(argv[reportIdx + 1]).trim() : undefined;
  /** @type {string[]} */
  const argvFlags = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    if (a === "--report") {
      i++;
      continue;
    }
    argvFlags.push(a);
  }
  return { noReport, reportPathArg, dryRun, argvFlags };
}

/**
 * @param {object} opts
 * @param {string} opts.packageId
 * @param {string} opts.packageTitle
 * @param {string} opts.verb
 * @param {string[]} [opts.argv]
 * @param {Record<string, boolean | string>} [opts.extraFlags]
 * @param {string[]} [opts.manifestNextSteps]
 * @returns {OperationReportContext}
 */
export function createOperationReportContext(opts) {
  const argv = opts.argv ?? [];
  const parsed = parseOperationReportArgv(argv);
  /** @type {Record<string, boolean | string>} */
  const flags = {
    dryRun: parsed.dryRun,
    noReport: parsed.noReport,
    ...(opts.extraFlags ?? {}),
  };
  if (parsed.reportPathArg) flags.reportPath = parsed.reportPathArg;

  return {
    packageId: opts.packageId,
    packageTitle: opts.packageTitle,
    verb: opts.verb,
    collectedAt: new Date().toISOString(),
    dryRun: parsed.dryRun,
    flags,
    steps: [],
    warnings: [],
    ok: null,
    exitCode: null,
    stdoutPayload: null,
    inventory: [],
    manifestNextSteps: opts.manifestNextSteps ?? [],
    reportPath: null,
    repoRoot: null,
    argvFlags: parsed.argvFlags,
  };
}

/**
 * @param {OperationReportContext} ctx
 * @param {string} msg
 */
export function pushWarning(ctx, msg) {
  const t = String(msg).trim();
  if (t) ctx.warnings.push(t);
}

/**
 * @param {OperationReportContext} ctx
 * @param {Omit<OperationStepRecord, "notes"> & { notes?: string[] }} step
 */
export function recordStep(ctx, step) {
  ctx.steps.push({
    id: step.id,
    title: step.title,
    ran: step.ran,
    skipReason: step.skipReason,
    ok: step.ok,
    notes: step.notes ?? [],
  });
}

/**
 * @param {OperationReportContext} ctx
 * @param {{ ok: boolean; dryRun?: boolean; exitCode?: number }} outcome
 */
export function setOutcome(ctx, outcome) {
  ctx.ok = outcome.ok;
  if (outcome.dryRun !== undefined) ctx.dryRun = outcome.dryRun;
  if (outcome.exitCode !== undefined) ctx.exitCode = outcome.exitCode;
}

/**
 * @param {OperationReportContext} ctx
 * @param {Record<string, unknown>} payload
 */
export function setStdoutPayload(ctx, payload) {
  ctx.stdoutPayload = payload;
}

/**
 * @param {OperationReportContext} ctx
 * @param {string} root
 * @param {string[]} systemIds
 */
export function addInventoryContext(ctx, root, systemIds) {
  ctx.repoRoot = root;
  const seen = new Set(ctx.inventory.map((i) => i.systemId));
  for (const systemId of systemIds) {
    if (!systemId?.trim() || seen.has(systemId)) continue;
    seen.add(systemId);
    const system = loadManualSystemSidecar(root, systemId);
    const serviceIds = system ? serviceIdsFromSystem(system) : [];
    const services = serviceIds
      .map((id) => loadManualServiceSidecar(root, id))
      .filter((s) => s !== null);
    ctx.inventory.push({
      systemId,
      system,
      services: /** @type {Record<string, unknown>[]} */ (services),
      inventoryIp: system ? primaryIpFromSystem(system) : null,
      accessNodes: system ? accessNodesFromSystem(system) : [],
    });
  }
}

/**
 * @param {string} packageRoot
 * @param {string} verb
 * @param {string} [reportPathArg]
 * @param {string} [publicRoot] hdc repo root; when set, prefer hdc-private for default path
 * @returns {string}
 */
export function defaultOperationReportPath(packageRoot, verb, reportPathArg, publicRoot) {
  if (reportPathArg?.trim()) {
    const p = reportPathArg.trim();
    return isAbsolute(p) ? p : resolve(process.cwd(), p);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const basename = `${verb}-${ts}.md`;
  if (publicRoot?.trim()) {
    return preferredPackageReportPath(publicRoot.trim(), packageRoot, basename);
  }
  return join(packageRoot, "reports", basename);
}

/**
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function redactSecretsForReport(value, depth = 0) {
  if (depth > 8) return "[depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 200 && SECRET_KEY_RE.test(value)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactSecretsForReport(v, depth + 1));
  }
  if (typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
      if (SECRET_KEY_RE.test(k) && (typeof v === "string" || typeof v === "number")) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactSecretsForReport(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string | null}
 */
function deployIpFromResult(result) {
  const ip = result.ip;
  if (typeof ip === "string" && ip.trim()) return ip.trim();
  const details = result.result;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const d = /** @type {Record<string, unknown>} */ (details).details;
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const inner = /** @type {Record<string, unknown>} */ (d).ip;
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string | null}
 */
function systemIdFromResult(result) {
  const sid = result.system_id ?? result.systemId;
  return typeof sid === "string" && sid.trim() ? sid.trim() : null;
}

/**
 * @param {OperationReportContext} ctx
 * @returns {Record<string, unknown>[]}
 */
function resultsFromPayload(ctx) {
  const p = ctx.stdoutPayload;
  if (!p) return [];
  const results = p.results ?? p.instances;
  if (Array.isArray(results)) {
    return results.filter((r) => r && typeof r === "object" && !Array.isArray(r));
  }
  if (p.system_id || p.systemId || p.host_id) {
    return [p];
  }
  return [];
}

/**
 * @param {OperationReportContext} ctx
 * @returns {string[]}
 */
export function defaultNextSteps(ctx) {
  const pkg = ctx.packageId;
  const verb = ctx.verb;
  /** @type {string[]} */
  const lines = [];

  if (verb === "deploy") {
    lines.push(`Run \`node tools/hdc/cli.mjs run ${pkg} query\` to verify the deployment.`);
    const results = resultsFromPayload(ctx);
    for (const r of results) {
      const sid = systemIdFromResult(r);
      if (!sid) continue;
      const deployIp = deployIpFromResult(r);
      if (deployIp) {
        lines.push(
          `Update \`inventory/manual/systems/${sid}.json\` → \`access.nodes[0].ip\` to \`${deployIp}\` if not already set.`,
        );
      } else {
        lines.push(
          `Set \`access.nodes[0].ip\` in \`inventory/manual/systems/${sid}.json\` after the guest has an address.`,
        );
      }
    }
    lines.push("Run inventory validation when sidecars change (schema under `tools/hdc/schema/`).");
  } else if (verb === "maintain") {
    lines.push(`Run \`node tools/hdc/cli.mjs run ${pkg} query\` to confirm service health.`);
    lines.push(`Re-run maintain on a schedule or after config changes: \`hdc run ${pkg} maintain\`.`);
  } else if (verb === "teardown") {
    lines.push("Confirm guests/containers are removed in Proxmox or Docker.");
    lines.push("Update or remove related `inventory/manual/systems/*.json` sidecars if the system is retired.");
    lines.push("Remove unused vault secret names documented in the package manifest when no longer needed.");
  }

  return lines;
}

/**
 * @param {OperationReportContext} ctx
 * @returns {string[]}
 */
function renderArgvFlagsMarkdown(ctx) {
  const lines = ["## CLI flags", ""];
  if (ctx.dryRun) lines.push("- **Dry run:** yes");
  if (ctx.flags.noReport) lines.push("- **Report:** skipped (`--no-report`)");
  if (ctx.argvFlags.length) {
    lines.push("- **Flags:** " + ctx.argvFlags.join(", "));
  } else {
    lines.push("- **Flags:** —");
  }
  lines.push("");
  return lines;
}

/**
 * @param {OperationStepRecord} step
 */
function stepStatusLabel(step) {
  if (!step.ran) return step.skipReason ? `skipped (${step.skipReason})` : "skipped";
  if (step.ok === true) return "ok";
  if (step.ok === false) return "failed";
  return "—";
}

/**
 * @param {OperationReportContext} ctx
 * @returns {string[]}
 */
function renderStepsMarkdown(ctx) {
  const lines = ["## Steps executed", ""];
  if (!ctx.steps.length) {
    lines.push("_No steps recorded._", "");
    return lines;
  }
  lines.push("| Step | Status | Result | Notes |", "| --- | --- | --- | --- |");
  for (const s of ctx.steps) {
    const notes = s.notes.length ? s.notes.join("; ") : "—";
    lines.push(`| ${s.title} | ${s.ran ? "ran" : "skipped"} | ${stepStatusLabel(s)} | ${notes} |`);
  }
  lines.push("");
  return lines;
}

/**
 * @param {OperationReportContext} ctx
 * @returns {string[]}
 */
function renderSystemsMarkdown(ctx) {
  const lines = ["## Systems / instances", ""];
  const results = resultsFromPayload(ctx);
  if (!results.length && !ctx.inventory.length) {
    lines.push("_No system results recorded._", "");
    return lines;
  }

  const byId = new Map(ctx.inventory.map((i) => [i.systemId, i]));

  for (const r of results) {
    const sid = systemIdFromResult(r);
    const title = sid ?? "(unknown)";
    lines.push(`### ${title}`, "");
    lines.push(`- **Result:** ${r.ok === true ? "ok" : r.ok === false ? "failed" : "—"}`);
    if (typeof r.message === "string" && r.message.trim()) {
      lines.push(`- **Message:** ${r.message.trim()}`);
    }
    if (r.redeploy === true) lines.push("- **Redeploy:** yes");
    if (typeof r.mode === "string") lines.push(`- **Mode:** ${r.mode}`);
    if (typeof r.role === "string") lines.push(`- **Role:** ${r.role}`);
    if (typeof r.step === "string") lines.push(`- **Step:** ${r.step}`);
    const deployIp = deployIpFromResult(r);
    if (deployIp) lines.push(`- **IP (from run):** ${deployIp}`);
    const hostId = r.host_id;
    if (typeof hostId === "string" && hostId.trim()) lines.push(`- **Proxmox host:** ${hostId.trim()}`);
    lines.push("");
    if (sid && !byId.has(sid) && ctx.repoRoot) {
      addInventoryContext(ctx, ctx.repoRoot, [sid]);
    }
  }

  for (const inv of ctx.inventory) {
    if (results.some((r) => systemIdFromResult(r) === inv.systemId)) continue;
    lines.push(`### ${inv.systemId}`, "");
    lines.push("- **Result:** _(inventory context only)_", "");
  }

  return lines;
}

/**
 * @param {OperationReportContext} ctx
 * @returns {string[]}
 */
function renderAccessMarkdown(ctx) {
  const lines = ["## Access", ""];
  const results = resultsFromPayload(ctx);
  const ipBySystem = new Map();
  for (const r of results) {
    const sid = systemIdFromResult(r);
    const ip = deployIpFromResult(r);
    if (sid && ip) ipBySystem.set(sid, ip);
  }

  let any = false;
  for (const inv of ctx.inventory) {
    const effectiveIp = ipBySystem.get(inv.systemId) ?? inv.inventoryIp;
    const nodes = inv.accessNodes.length ? inv.accessNodes : [{ ip: effectiveIp ?? undefined }];
    if (!nodes.length && !effectiveIp) continue;
    any = true;
    lines.push(`### ${inv.systemId}`, "");
    for (const n of nodes) {
      const ip = n.ip ?? effectiveIp;
      if (n.name) lines.push(`- **Name:** ${n.name}`);
      if (ip) lines.push(`- **IP:** ${ip}`);
      if (n.web_ui) lines.push(`- **Web UI:** ${n.web_ui}`);
      else if (ip && ctx.packageId === "pi-hole") {
        lines.push(`- **Web UI:** http://${ip}/admin/`);
      }
      if (n.ssh) lines.push(`- **SSH:** ${n.ssh}`);
    }
    if (!inv.inventoryIp && ipBySystem.has(inv.systemId)) {
      lines.push(
        `- _Set \`access.nodes[0].ip\` in inventory to \`${ipBySystem.get(inv.systemId)}\`._`,
      );
    }
    lines.push("");
  }

  if (!any) lines.push("_No access endpoints recorded (check inventory sidecars after deploy)._", "");
  return lines;
}

/**
 * @param {OperationReportContext} ctx
 * @returns {string[]}
 */
function renderServiceNotesMarkdown(ctx) {
  const lines = ["## Service notes (inventory)", ""];
  let any = false;
  for (const inv of ctx.inventory) {
    for (const svc of inv.services) {
      const id = svc.id;
      const notes = svc.notes;
      if (typeof notes !== "string" || !notes.trim()) continue;
      any = true;
      const label = typeof id === "string" ? id : "service";
      lines.push(`### ${label}`, "", notes.trim(), "");
    }
  }
  if (!any) lines.push("_No service notes in inventory._", "");
  return lines;
}

/**
 * @param {OperationReportContext} ctx
 * @returns {string[]}
 */
function renderNextStepsMarkdown(ctx) {
  const lines = ["## Suggested next steps", ""];
  const all = [...defaultNextSteps(ctx), ...ctx.manifestNextSteps];
  const unique = [...new Set(all)];
  for (const s of unique) lines.push(`- ${s}`);
  lines.push("");
  return lines;
}

/**
 * @param {OperationReportContext} ctx
 * @returns {string[]}
 */
function renderWarningsMarkdown(ctx) {
  const lines = ["## Warnings", ""];
  if (!ctx.warnings.length) {
    lines.push("_None._", "");
    return lines;
  }
  for (const w of ctx.warnings) lines.push(`- ${w}`);
  lines.push("");
  return lines;
}

/**
 * @param {OperationReportContext} ctx
 * @returns {string[]}
 */
function renderStdoutSummaryMarkdown(ctx) {
  const lines = ["## Run summary (JSON)", ""];
  if (!ctx.stdoutPayload) {
    lines.push("_No stdout payload attached._", "");
    return lines;
  }
  const safe = redactSecretsForReport(ctx.stdoutPayload);
  lines.push("```json", JSON.stringify(safe, null, 2), "```", "");
  return lines;
}

/**
 * @param {OperationReportContext} ctx
 * @param {string} [reportPathForHeader]
 * @param {(ctx: OperationReportContext) => string[]} [extraSections]
 * @returns {string}
 */
export function renderOperationReportMarkdown(ctx, reportPathForHeader, extraSections) {
  const outcome =
    ctx.ok === true ? "OK" : ctx.ok === false ? "FAILED" : ctx.exitCode === 0 ? "OK" : "—";
  const title = `${ctx.packageTitle} ${ctx.verb} report`;

  /** @type {string[]} */
  const lines = [
    `# ${title}`,
    "",
    `- **Collected:** ${ctx.collectedAt}`,
    `- **Package:** \`${ctx.packageId}\``,
    `- **Verb:** ${ctx.verb}`,
    `- **Outcome:** ${outcome}`,
    `- **Dry run:** ${ctx.dryRun ? "yes" : "no"}`,
  ];
  if (reportPathForHeader) {
    lines.push(`- **Report file:** ${reportPathForHeader}`);
  }
  lines.push("");

  lines.push(...renderArgvFlagsMarkdown(ctx));
  lines.push(...renderStepsMarkdown(ctx));
  lines.push(...renderSystemsMarkdown(ctx));
  lines.push(...renderAccessMarkdown(ctx));
  lines.push(...renderServiceNotesMarkdown(ctx));
  lines.push(...renderNextStepsMarkdown(ctx));
  lines.push(...renderWarningsMarkdown(ctx));

  if (extraSections) {
    const extra = extraSections(ctx);
    if (extra.length) {
      lines.push(...extra);
      if (!extra[extra.length - 1]?.endsWith("\n") && extra[extra.length - 1] !== "") lines.push("");
    }
  }

  lines.push(...renderStdoutSummaryMarkdown(ctx));
  return `${lines.join("\n")}\n`;
}

/**
 * Collect system ids from stdout payload for inventory enrichment.
 * @param {Record<string, unknown> | null} payload
 * @returns {string[]}
 */
export function systemIdsFromStdoutPayload(payload) {
  if (!payload) return [];
  /** @type {string[]} */
  const ids = [];
  const results = payload.results ?? payload.instances;
  if (Array.isArray(results)) {
    for (const r of results) {
      if (!r || typeof r !== "object" || Array.isArray(r)) continue;
      const sid = systemIdFromResult(/** @type {Record<string, unknown>} */ (r));
      if (sid) ids.push(sid);
    }
  }
  const single = systemIdFromResult(payload);
  if (single) ids.push(single);
  return [...new Set(ids)];
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {OperationReportContext} opts.ctx
 * @param {string} [opts.reportPathArg]
 * @param {(ctx: OperationReportContext) => string[]} [opts.extraSections]
 * @param {string} [opts.repoRoot] for inventory if not set on ctx
 * @returns {string | null}
 */
export function writeOperationReportFile(opts) {
  const { packageRoot, ctx, reportPathArg, extraSections, repoRoot } = opts;
  if (ctx.flags.noReport) return null;

  const root = repoRoot ?? ctx.repoRoot;
  if (root) {
    const ids = systemIdsFromStdoutPayload(ctx.stdoutPayload);
    if (ids.length) addInventoryContext(ctx, root, ids);
  }

  const outPath = defaultOperationReportPath(
    packageRoot,
    ctx.verb,
    reportPathArg,
    root ?? undefined,
  );
  ctx.reportPath = outPath;
  const markdown = renderOperationReportMarkdown(ctx, outPath, extraSections);
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, markdown, "utf8");
  return outPath;
}

/**
 * Load optional manifest next_steps.
 * @param {Record<string, unknown> | null} manifestRaw
 * @returns {string[]}
 */
export function manifestOperationReportNextSteps(manifestRaw) {
  if (!manifestRaw || typeof manifestRaw !== "object" || Array.isArray(manifestRaw)) return [];
  const op = manifestRaw.operation_report;
  if (!op || typeof op !== "object" || Array.isArray(op)) return [];
  const steps = /** @type {Record<string, unknown>} */ (op).next_steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => String(s).trim());
}

/**
 * Finalize report after building stdout payload (common tail helper).
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {OperationReportContext} opts.ctx
 * @param {string} opts.repoRoot
 * @param {Record<string, unknown>} opts.payload
 * @param {boolean} opts.ok
 * @param {(line: string) => void} opts.log
 * @param {(ctx: OperationReportContext) => string[]} [opts.extraSections]
 * @param {string} [opts.reportPathArg]
 */
/**
 * @param {string} packageRoot
 * @returns {{ id: string; title: string; nextSteps: string[] }}
 */
export function loadPackageManifestForReport(packageRoot) {
  const path = join(packageRoot, "manifest.json");
  if (!existsSync(path)) {
    return { id: "unknown", title: "Unknown package", nextSteps: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { id: "unknown", title: "Unknown package", nextSteps: [] };
    }
    const m = /** @type {Record<string, unknown>} */ (raw);
    const id = typeof m.id === "string" ? m.id : "unknown";
    const title = typeof m.title === "string" ? m.title : id;
    return { id, title, nextSteps: manifestOperationReportNextSteps(m) };
  } catch {
    return { id: "unknown", title: "Unknown package", nextSteps: [] };
  }
}

/**
 * Standard report tail for package run.mjs scripts.
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {string} opts.repoRoot
 * @param {string} opts.verb
 * @param {string[]} opts.argv
 * @param {Record<string, unknown>} opts.payload
 * @param {boolean} opts.ok
 * @param {(line: string) => void} opts.log
 * @param {OperationReportContext} [opts.reportCtx]
 * @param {(ctx: OperationReportContext) => string[]} [opts.extraSections]
 * @returns {string | null}
 */
export function runOperationReportTail(opts) {
  const manifest = loadPackageManifestForReport(opts.packageRoot);
  const ctx =
    opts.reportCtx ??
    createOperationReportContext({
      packageId: manifest.id,
      packageTitle: manifest.title,
      verb: opts.verb,
      argv: opts.argv,
      manifestNextSteps: manifest.nextSteps,
    });
  return finalizeOperationReport({
    packageRoot: opts.packageRoot,
    ctx,
    repoRoot: opts.repoRoot,
    payload: opts.payload,
    ok: opts.ok,
    log: opts.log,
    extraSections: opts.extraSections,
  });
}

export function finalizeOperationReport(opts) {
  const { packageRoot, ctx, repoRoot, payload, ok, log, extraSections, reportPathArg } = opts;
  setStdoutPayload(ctx, payload);
  setOutcome(ctx, { ok, exitCode: ok ? 0 : 1 });
  if (!ctx.repoRoot) ctx.repoRoot = repoRoot;
  const pathArg =
    reportPathArg ??
    (typeof ctx.flags.reportPath === "string" ? ctx.flags.reportPath : undefined);
  const written = writeOperationReportFile({
    packageRoot,
    ctx,
    reportPathArg: pathArg,
    extraSections,
    repoRoot,
  });
  if (written) log(`report ${written}`);
  return written;
}
