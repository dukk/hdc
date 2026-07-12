import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  discoverManifests,
  manifestByTierAndId,
  manifestId,
  manifestRunTier,
  manifestTitle,
  resolveRunInvocation,
  runScriptDir,
  verbSpec,
} from "../manifests.mjs";
import { resolveClumpConfig } from "./clump-config.mjs";
import { preferredNewFilePath } from "./private-repo.mjs";
import { splitRunArgs } from "./split-run-args.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import {
  buildClumpRunEnv,
} from "./clump-env.mjs";
import {
  buildDailyStepArgs,
  dailyRecipeSteps,
  filterDailyRecipeSteps,
  packageRefKey,
  parseDailyMaintainArgv,
} from "./daily-maintain-recipe.mjs";

/**
 * @typedef {import("./cli-app.mjs").CliDeps} CliDeps
 * @typedef {import("./daily-maintain-recipe.mjs").DailyRecipeStep} DailyRecipeStep
 */

/**
 * @typedef {object} DailyStepResult
 * @property {string} key
 * @property {DailyTier} tier
 * @property {string} id
 * @property {string} title
 * @property {'maintain' | 'query' | 'skipped'} status
 * @property {string} [verb]
 * @property {string[]} [args]
 * @property {string} [skipReason]
 * @property {boolean | null} ok
 * @property {number} exitCode
 * @property {number} durationMs
 * @property {string} [invoke]
 * @property {Record<string, unknown> | null} [payload]
 * @property {string} [error]
 */

/**
 * @typedef {object} DailyMaintainResult
 * @property {number} exitCode
 * @property {boolean} dryRun
 * @property {string} collectedAt
 * @property {DailyStepResult[]} results
 * @property {string} [reportPath]
 * @property {string} [reportBody]
 */

/** @typedef {import("./daily-maintain-recipe.mjs").DailyTier} DailyTier */

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {DailyTier} tier
 * @param {string} id
 * @returns {string}
 */
function configPackageRoot(deps, root, tier, id) {
  const manifests = discoverManifests(deps.clumpsDir(root));
  const m = manifestByTierAndId(manifests, tier, id);
  if (m) return m.dir;
  const tierDir =
    tier === "client" ? "clients" : tier === "infrastructure" ? "infrastructure" : "services";
  return join(deps.clumpsDir(root), tierDir, id);
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {DailyRecipeStep} step
 * @returns {boolean}
 */
function stepHasConfig(deps, root, step) {
  if (step.requiresConfig === false) return true;
  const clumpRoot = configPackageRoot(deps, root, step.tier, step.id);
  const resolved = resolveClumpConfig(root, clumpRoot, "config.json", deps.env);
  return resolved.found;
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {DailyRecipeStep} step
 * @returns {{ m: { path: string; dir: string; raw: Record<string, unknown> }; script: string; cwd: string } | { error: string }}
 */
function resolveStepScript(deps, root, step) {
  const manifests = discoverManifests(deps.clumpsDir(root));
  const m = manifestByTierAndId(manifests, step.tier, step.id);
  if (!m) {
    return { error: `manifest not found for ${packageRefKey(step.tier, step.id)}` };
  }
  const verb = step.verb ?? "maintain";
  const inv = resolveRunInvocation([manifestId(m), verb], m);
  if ("error" in inv) {
    return { error: inv.error };
  }
  const spec = verbSpec(m, inv.verb);
  if (!spec) {
    return { error: `package ${step.id} has no ${verb} script` };
  }
  const cwd = runScriptDir(m, inv.platform, inv.verb);
  const script = deps.join(cwd, spec.script);
  if (!deps.existsSync(script)) {
    return { error: `missing script ${script}` };
  }
  return { m, script, cwd };
}

/**
 * @param {string} stdout
 * @returns {Record<string, unknown> | null}
 */
function parseStdoutPayload(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {CliDeps} deps
 * @param {string} tier
 * @param {string} id
 * @param {string} verb
 * @param {string[]} args
 * @returns {string}
 */
function formatInvokeLine(deps, tier, id, verb, args) {
  const base = `${deps.cliInvocationForHelp()} run ${tier} ${id} ${verb}`;
  return args.length ? `${base} -- ${args.join(" ")}` : base;
}

/**
 * @param {DailyStepResult[]} results
 * @param {{ dryRun: boolean; collectedAt: string; argv: string[] }} meta
 * @returns {string}
 */
function renderDailyMaintainReport(results, meta) {
  const lines = [];
  lines.push("# HDC daily maintain report");
  lines.push("");
  lines.push(`- **Collected:** ${meta.collectedAt}`);
  lines.push(`- **Dry run:** ${meta.dryRun ? "yes" : "no"}`);
  if (meta.argv.length) {
    lines.push(`- **Flags:** ${meta.argv.map((a) => `\`${a}\``).join(" ")}`);
  }
  lines.push("");

  const ran = results.filter((r) => r.status !== "skipped");
  const failed = ran.filter((r) => r.ok === false);
  const ok = failed.length === 0;
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`- **Overall:** ${ok ? "OK" : "FAILED"}`);
  lines.push(`- **Steps:** ${results.length} planned, ${ran.length} ran, ${results.length - ran.length} skipped`);
  lines.push(`- **Failures:** ${failed.length}`);
  lines.push("");

  lines.push("| Package | Verb | Status | Duration | Notes |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of results) {
    const status =
      r.status === "skipped"
        ? `skipped (${r.skipReason ?? "?"})`
        : r.ok
          ? "ok"
          : "failed";
    const dur = r.status === "skipped" ? "—" : `${r.durationMs}ms`;
    const notes = r.error ?? (r.payload && "message" in r.payload ? String(r.payload.message) : "") ?? "";
    lines.push(`| ${r.key} | ${r.verb ?? "—"} | ${status} | ${dur} | ${notes.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");

  const failures = results.filter((r) => r.ok === false);
  if (failures.length) {
    lines.push("## Failures");
    lines.push("");
    for (const r of failures) {
      lines.push(`### ${r.key} (${r.verb})`);
      lines.push("");
      if (r.invoke) lines.push(`\`${r.invoke}\``);
      if (r.error) lines.push(`- ${r.error}`);
      if (r.payload) {
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(r.payload, null, 2));
        lines.push("```");
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

/**
 * @param {string} root
 * @param {string} basename
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function defaultReportPath(root, basename, env) {
  return preferredNewFilePath(root, join("apps", "hdc-cli", "reports", basename).replace(/\\/g, "/"), env);
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {string[]} argv
 * @returns {Promise<DailyMaintainResult>}
 */
export async function runDailyMaintainWithResult(deps, root, argv) {
  const flags = parseDailyMaintainArgv(argv);
  const recipe = filterDailyRecipeSteps(dailyRecipeSteps(), {
    only: flags.only.size ? flags.only : undefined,
    skip: flags.skip,
    skipClients: flags.skipClients,
  });

  const collectedAt = new Date().toISOString();
  deps.log(`[hdc] maintain daily: ${recipe.length} recipe step(s)${flags.dryRun ? " (dry-run)" : ""}.`);

  if (!flags.dryRun) {
    const vault = createVaultAccess(vaultDepsFromCli(deps));
    try {
      await vault.unlock({});
    } catch (e) {
      deps.error(`[hdc] maintain daily: vault unlock failed: ${/** @type {Error} */ (e).message || e}`);
      return {
        exitCode: 1,
        dryRun: flags.dryRun,
        collectedAt,
        results: [],
      };
    }
  }

  /** @type {DailyStepResult[]} */
  const results = [];
  let exitCode = 0;

  for (const step of recipe) {
    const key = packageRefKey(step.tier, step.id);
    const stepKey = step.verb ? `${key}/${step.verb}` : key;

    if (step.skipReason) {
      deps.log(`[hdc] maintain daily: skip ${stepKey} (${step.skipReason})`);
      results.push({
        key: stepKey,
        tier: step.tier,
        id: step.id,
        title: step.id,
        status: "skipped",
        skipReason: step.skipReason,
        ok: null,
        exitCode: 0,
        durationMs: 0,
      });
      continue;
    }

    if (step.requiresConfig !== false && !stepHasConfig(deps, root, step)) {
      deps.log(`[hdc] maintain daily: skip ${stepKey} (no config.json)`);
      results.push({
        key: stepKey,
        tier: step.tier,
        id: step.id,
        title: step.id,
        status: "skipped",
        skipReason: "no config",
        ok: null,
        exitCode: 0,
        durationMs: 0,
      });
      continue;
    }

    const resolved = resolveStepScript(deps, root, step);
    if ("error" in resolved) {
      deps.error(`[hdc] maintain daily: ${stepKey}: ${resolved.error}`);
      results.push({
        key: stepKey,
        tier: step.tier,
        id: step.id,
        title: step.id,
        status: "skipped",
        verb: step.verb,
        skipReason: resolved.error,
        ok: false,
        exitCode: 1,
        durationMs: 0,
        error: resolved.error,
      });
      exitCode = 1;
      continue;
    }

    const args = buildDailyStepArgs(step, { skipUpgrades: flags.skipUpgrades });
    const invoke = formatInvokeLine(deps, step.tier, step.id, step.verb ?? "maintain", args);
    const title = manifestTitle(resolved.m);

    if (flags.dryRun) {
      deps.log(`[hdc] maintain daily: plan ${invoke}`);
      results.push({
        key: stepKey,
        tier: step.tier,
        id: step.id,
        title,
        status: step.verb ?? "maintain",
        verb: step.verb,
        args,
        ok: null,
        exitCode: 0,
        durationMs: 0,
        invoke,
      });
      continue;
    }

    deps.log(`[hdc] maintain daily: run ${invoke}`);
    const started = Date.now();
    const pipeStdoutJson =
      step.verb === "query" || step.verb === "maintain";
    const runEnv = buildClumpRunEnv(deps, root, resolved.m);
    const r = deps.spawnSync(deps.execPath, [resolved.script, ...args], {
      cwd: resolved.cwd,
      stdio: pipeStdoutJson ? ["inherit", "pipe", "inherit"] : "inherit",
      env: runEnv,
      shell: false,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const durationMs = Date.now() - started;
    const status = r.status ?? 1;
    const stdoutStr =
      pipeStdoutJson && r.stdout !== undefined && r.stdout !== null
        ? typeof r.stdout === "string"
          ? r.stdout
          : String(r.stdout)
        : "";
    const payload = parseStdoutPayload(stdoutStr);
    const ok = status === 0 && (payload?.ok === undefined || payload.ok !== false);

    if (!ok) {
      exitCode = 1;
      deps.error(`[hdc] maintain daily: ${stepKey} failed (exit ${status})`);
    } else {
      deps.log(`[hdc] maintain daily: ${stepKey} ok (${durationMs}ms)`);
    }

    results.push({
      key: stepKey,
      tier: step.tier,
      id: step.id,
      title,
      status: step.verb ?? "maintain",
      verb: step.verb,
      args,
      ok,
      exitCode: status,
      durationMs,
      invoke,
      payload,
      error: ok ? undefined : `exit ${status}`,
    });
  }

  /** @type {string | undefined} */
  let reportPath;
  /** @type {string | undefined} */
  let reportBody;
  if (!flags.noReport) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    reportPath =
      flags.reportPath ?? defaultReportPath(root, `daily-maintain-${ts}.md`, deps.env);
    reportBody = renderDailyMaintainReport(results, {
      dryRun: flags.dryRun,
      collectedAt,
      argv,
    });
    try {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, reportBody, "utf8");
      deps.log(`[hdc] maintain daily: report ${reportPath}`);
    } catch (e) {
      deps.warn(`[hdc] maintain daily: failed to write report: ${/** @type {Error} */ (e).message || e}`);
      reportPath = undefined;
      reportBody = undefined;
    }
  }

  return {
    exitCode,
    dryRun: flags.dryRun,
    collectedAt,
    results,
    reportPath,
    reportBody,
  };
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runDailyMaintain(deps, root, argv) {
  const result = await runDailyMaintainWithResult(deps, root, argv);
  return result.exitCode;
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {string[]} argv argv after `maintain` (e.g. `daily` and flags)
 * @returns {Promise<number>}
 */
export async function cmdMaintainDaily(deps, root, argv) {
  const sub = argv[0];
  if (sub !== "daily") {
    deps.error(`maintain: unknown subcommand ${JSON.stringify(sub ?? "")} (try: maintain daily)`);
    return 1;
  }
  const { forward, extra } = splitRunArgs(argv.slice(1));
  const dailyArgv = [...forward, ...extra];
  return runDailyMaintain(deps, root, dailyArgv);
}
