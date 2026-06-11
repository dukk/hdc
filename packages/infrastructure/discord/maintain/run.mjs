#!/usr/bin/env node
/**
 * Discord maintain: PATCH managed Developer applications.
 *
 * Usage: hdc run infrastructure discord maintain --
 *   [--app <id>] [--dry-run] [--no-derive] [--no-report] [--report <path>]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  createOperationReportContext,
  recordStep,
  runOperationReportTail,
  setOutcome,
  setStdoutPayload,
  pushWarning,
} from "../../../lib/operation-report.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { printDeveloperPortalChecklist } from "../lib/discord-checklist.mjs";
import { collectDiscordState, fetchLiveApplication } from "../lib/discord-collect.mjs";
import { createDiscordClient } from "../lib/discord-api.mjs";
import { normalizeDiscordConfig, PACKAGE_CONFIG_EXAMPLE } from "../lib/discord-config.mjs";
import { applyAppSync, planAppSync } from "../lib/discord-sync.mjs";
import { createDiscordVaultAccess, resolveDiscordBotToken } from "../lib/vault-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const packageRoot = join(here, "..");

const MANIFEST_NEXT_STEPS = [
  "Run `hdc run infrastructure discord query --` to verify application drift.",
  "Enable privileged Gateway Intents in the Discord Developer Portal when checklist items are listed.",
  "After token rotation, update vault secrets and re-run query.",
];

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[discord] ${line}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgvFlags(argv);
  const appFilter = flagGet(flags, "app");
  const noDerive = flags["no-derive"] === "1";

  const reportCtx = createOperationReportContext({
    packageId: "discord",
    packageTitle: "Discord applications",
    verb,
    argv,
    manifestNextSteps: MANIFEST_NEXT_STEPS,
  });

  log(`${verb}: starting${reportCtx.dryRun ? " (dry-run)" : ""}`);

  const { data: cfgRaw, source } = loadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const config = normalizeDiscordConfig(cfgRaw);
  const vault = createDiscordVaultAccess();

  let entries = config.applications.filter((a) => a.managed);
  if (appFilter) {
    const one = config.applicationsById.get(appFilter);
    if (!one) throw new Error(`Application not in config applications[]: ${appFilter}`);
    if (!one.managed) throw new Error(`Application is not managed: ${appFilter}`);
    entries = [one];
  }

  if (!entries.length) {
    pushWarning(reportCtx, "No managed applications[] entries to maintain.");
  }

  let overallOk = true;

  for (const entry of entries) {
    let live = null;
    try {
      const token = await resolveDiscordBotToken(vault, entry.bot_token_vault_key);
      const api = createDiscordClient({ botToken: token, apiBaseUrl: config.apiBase });
      live = await fetchLiveApplication(api, log);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`key ${entry.id}: live fetch failed: ${msg}`);
      recordStep(reportCtx, {
        id: `app-${entry.id}`,
        title: `Maintain: ${entry.display_name}`,
        ran: false,
        skipReason: "live fetch failed",
        ok: false,
        notes: [msg],
      });
      overallOk = false;
      continue;
    }

    const plan = planAppSync({
      configApp: entry,
      live,
      noDerive,
      warn: (msg) => log(`warning: ${msg}`),
    });
    log(`app ${entry.id}: plan action=${plan.action}`);

    let applyResult = { ok: true, action: plan.action };
    if (plan.action === "update") {
      const token = await resolveDiscordBotToken(vault, entry.bot_token_vault_key);
      const api = createDiscordClient({ botToken: token, apiBaseUrl: config.apiBase });
      applyResult = await applyAppSync(api, plan, {
        dryRun: reportCtx.dryRun,
        log,
      });
    } else {
      applyResult = await applyAppSync(
        createDiscordClient({ botToken: "dry-run", apiBaseUrl: config.apiBase }),
        plan,
        { dryRun: reportCtx.dryRun, log }
      );
    }

    recordStep(reportCtx, {
      id: `app-${entry.id}`,
      title: `Maintain: ${entry.display_name}`,
      ran: plan.action === "update",
      skipReason:
        plan.action === "skip"
          ? plan.reason
          : plan.action === "unchanged"
            ? "unchanged"
            : undefined,
      ok: applyResult.ok,
      notes: applyResult.error ? [applyResult.error] : [],
    });

    if (!applyResult.ok) overallOk = false;
  }

  const snapshot = await collectDiscordState({
    config,
    vault,
    appFilterId: appFilter,
    noDerive,
    requireVault: false,
    warn: (msg) => log(`warning: ${msg}`),
    log,
  });

  if (snapshot.has_drift) {
    pushWarning(reportCtx, "Drift remains after maintain (extra redirect URIs are report-only in v1).");
  }

  printDeveloperPortalChecklist({
    developerPortalUrl: config.developerPortalUrl,
    applications: appFilter
      ? config.applications.filter((a) => a.id === appFilter)
      : config.applications,
    log,
  });

  setOutcome(reportCtx, { ok: overallOk, dryRun: reportCtx.dryRun, exitCode: overallOk ? 0 : 1 });
  setStdoutPayload(reportCtx, {
    config_source: source,
    applications: snapshot.applications,
    has_drift: snapshot.has_drift,
  });

  await runOperationReportTail({
    ctx: reportCtx,
    packageRoot,
    repoRoot: repoRoot(),
  });

  log(overallOk ? `${verb}: completed successfully` : `${verb}: completed with errors`);
  process.exitCode = overallOk ? 0 : 1;
}

main().catch(async (e) => {
  log(`failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
