#!/usr/bin/env node
/**
 * UniFi Network maintain: apply config port_forwards[] to the controller.
 *
 * Usage: hdc run infrastructure unifi-network maintain --
 *   [--dry-run] [--prune] [--rule <id>] [--no-report] [--report <path>]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  createOperationReportContext,
  recordStep,
  runOperationReportTail,
  setOutcome,
  setStdoutPayload,
  pushWarning,
} from "../../../lib/operation-report.mjs";
import { repoRoot } from "../../../../apps/hdc-cli/paths.mjs";
import { loadClumpConfigFromClumpRoot } from "../../../lib/clump-run-config.mjs";
import { createUnifiRunContext, fetchLivePortForwards } from "../lib/unifi-collect.mjs";
import { portForwardPassesFilter } from "../lib/unifi-config.mjs";
import { applyPortForwardSync, planPortForwardSync } from "../lib/unifi-port-forward-sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const clumpRoot = join(here, "..");

const MANIFEST_NEXT_STEPS = [
  "Run `hdc run infrastructure unifi-network query --` to verify diffs after maintain.",
  "Bootstrap from live: `query -- --import-port-forwards --yes`.",
];

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[unifi-network] ${line}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgvFlags(argv);
  const ruleId = flagGet(flags, "rule");
  const prune = flags.prune === "1";

  const reportCtx = createOperationReportContext({
    clumpId: "unifi-network",
    clumpTitle: "UniFi Network",
    verb,
    argv,
    manifestNextSteps: MANIFEST_NEXT_STEPS,
    extraFlags: { prune, rule: ruleId ?? null },
  });

  log(`${verb}: starting${reportCtx.dryRun ? " (dry-run)" : ""}${prune ? " (prune)" : ""}`);

  const ctx = await createUnifiRunContext({ clumpRoot, log });
  log(`config loaded (${ctx.configSource})`);

  const desired = ctx.config.managedPortForwards.filter((p) => portForwardPassesFilter(p, ruleId));
  if (!desired.length) {
    throw new Error(
      ruleId
        ? `No managed port_forwards[] entry with id ${ruleId}`
        : "No managed port_forwards[] entries in config",
    );
  }

  log(
    `Applying ${desired.length} managed port forward rule(s) (integration site ${ctx.siteId}, classic site ${ctx.classicSiteKey})`,
  );
  const liveRows = await fetchLivePortForwards(ctx, log);
  log(`Using classic site key "${ctx.classicSiteKey}" for writes`);

  let plan;
  try {
    plan = planPortForwardSync(desired, liveRows, prune);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`plan failed: ${msg}`);
  }

  log(
    `plan: create=${plan.summary.create} update=${plan.summary.update} (disable-first) delete=${plan.summary.delete} unchanged=${plan.summary.unchanged}`,
  );

  const applyResult = await applyPortForwardSync(ctx, plan, {
    dryRun: reportCtx.dryRun,
    log,
  });

  recordStep(reportCtx, {
    id: "port-forward-sync",
    title: "Sync port forwards",
    ran: true,
    ok: applyResult.ok,
    notes: [
      `create ${plan.summary.create}, update ${plan.summary.update}, delete ${plan.summary.delete}, unchanged ${plan.summary.unchanged}`,
      ...(applyResult.results.filter((r) => !r.ok).map((r) => `${r.action} ${r.key}: ${r.error}`)),
    ],
  });

  if (!applyResult.ok) {
    pushWarning(reportCtx, "One or more port forward changes failed");
  }

  setOutcome(reportCtx, {
    ok: applyResult.ok,
    dryRun: reportCtx.dryRun,
    exitCode: applyResult.ok ? 0 : 1,
  });
  setStdoutPayload(reportCtx, {
    site_id: ctx.siteId,
    plan: plan.summary,
    results: applyResult.results,
  });

  await runOperationReportTail({
    ctx: reportCtx,
    clumpRoot,
    repoRoot: repoRoot(),
    verb,
    argv,
    log,
    ok: applyResult.ok,
    payload: reportCtx.stdoutPayload,
  });

  log(applyResult.ok ? `${verb}: completed successfully` : `${verb}: completed with errors`);
  process.exitCode = applyResult.ok ? 0 : 1;
}

main().catch(async (e) => {
  log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
