#!/usr/bin/env node
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { loadClumpConfigFromClumpRoot } from "../../../lib/clump-run-config.mjs";
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
import { resolveOciResourceFilter } from "../lib/oci-config.mjs";
import { ociComputeReportExtraSections } from "../lib/oci-compute-report.mjs";
import { ociStdoutPayload, runOciPlanApply } from "../lib/oci-verb-common.mjs";
import { createOciComputeRunContext, CLUMP_CONFIG_EXAMPLE } from "../lib/oci-run-context.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const clumpRoot = join(here, "..");

function log(line) {
  errout.write(`[oci-compute] ${line}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgvFlags(argv);
  const resourceFilterRaw = flagGet(flags, "resource");
  const prune = flagGet(flags, "prune") !== undefined;

  const reportCtx = createOperationReportContext({
    clumpId: "oci-compute",
    clumpTitle: "Oracle Cloud compute",
    verb,
    argv,
  });

  log(`${verb}: starting${reportCtx.dryRun ? " (dry-run)" : ""}${prune ? " (prune)" : ""}`);

  const { data: cfgRaw, source } = loadClumpConfigFromClumpRoot(clumpRoot, {
    exampleRel: CLUMP_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const { config, client } = await createOciComputeRunContext(cfgRaw);
  const resourceFilter = resourceFilterRaw
    ? resolveOciResourceFilter(config, { resource: resourceFilterRaw })
    : null;

  if (prune) {
    pushWarning(reportCtx, "prune enabled: live HDC-tagged resources not in config may be deleted.");
  }

  const outcome = await runOciPlanApply({
    config,
    client,
    flags,
    prune,
    resourceFilter,
    log,
  });

  const payload = ociStdoutPayload(outcome);
  recordStep(reportCtx, {
    id: "maintain",
    title: "Reconcile OCI resources",
    ran: true,
    ok: !outcome.aborted || outcome.dry_run,
    notes: outcome.aborted ? ["aborted or dry-run"] : [`${outcome.results.length} operations`],
  });

  setStdoutPayload(reportCtx, payload);
  setOutcome(reportCtx, { ok: true, exitCode: 0 });
  console.log(JSON.stringify(payload, null, 2));
  await runOperationReportTail({
    clumpRoot,
    reportCtx,
    repoRoot: repoRoot(),
    payload,
    ok: true,
    log,
    extraSections: ociComputeReportExtraSections,
  });
}

main().catch((err) => {
  log(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
