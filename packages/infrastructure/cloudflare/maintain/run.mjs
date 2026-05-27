#!/usr/bin/env node
/**
 * Cloudflare maintain: apply DNS, page rules, and email routing from config.
 *
 * Usage: hdc run infrastructure cloudflare maintain --
 *   [--zone <name>] [--dry-run] [--prune] [--skip-page-rules] [--skip-email-routing]
 *   [--no-report] [--report <path>]
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
import { createCloudflareClient } from "../lib/cloudflare-api.mjs";
import { normalizeCloudflareConfig, normalizeZoneName, zonePassesFilter } from "../lib/cloudflare-config.mjs";
import { collectCloudflareDnsState } from "../lib/cloudflare-collect.mjs";
import { applyZoneSync, planZoneSync } from "../lib/cloudflare-sync.mjs";
import { applyPageRuleSync, planPageRuleSync } from "../lib/cloudflare-page-rules-sync.mjs";
import {
  applyCatchAllSync,
  applyEmailRoutingRuleSync,
  planCatchAllSync,
  planEmailRoutingRuleSync,
} from "../lib/cloudflare-email-routing-sync.mjs";
import { createCloudflareVaultAccess, resolveCloudflareToken } from "../lib/vault-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/infrastructure/cloudflare/config.example.json";

const MANIFEST_NEXT_STEPS = [
  "Run `hdc run infrastructure cloudflare query --` to verify diffs after maintain.",
  "Bootstrap rules: `query -- --import-page-rules --yes` or `--import-email-routing --yes`.",
  "Update registrar NS to Cloudflare when migrating public zones from BIND.",
];

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[cloudflare] ${line}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgvFlags(argv);
  const zoneName = flagGet(flags, "zone");
  const prune = flags.prune === "1";
  const skipPageRules = flags["skip-page-rules"] === "1";
  const skipEmailRouting = flags["skip-email-routing"] === "1";

  const reportCtx = createOperationReportContext({
    packageId: "cloudflare",
    packageTitle: "Cloudflare",
    verb,
    argv,
    manifestNextSteps: MANIFEST_NEXT_STEPS,
    extraFlags: { prune, skipPageRules, skipEmailRouting },
  });

  log(
    `${verb}: starting${reportCtx.dryRun ? " (dry-run)" : ""}${prune ? " (prune)" : ""}${skipPageRules ? " (skip page rules)" : ""}${skipEmailRouting ? " (skip email routing)" : ""}`
  );

  const { data: cfgRaw, source } = loadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const config = normalizeCloudflareConfig(cfgRaw);
  const vault = createCloudflareVaultAccess();
  const token = await resolveCloudflareToken(vault);
  log("API token loaded");

  const api = createCloudflareClient({
    token,
    baseUrl: config.apiBase,
    accountId: config.accountId,
  });

  const onlyZone = zoneName ? normalizeZoneName(zoneName) : null;
  /** @type {string[]} */
  const zonesToApply = config.zones
    .map((z) => z.name)
    .filter((name) => (!onlyZone || name === onlyZone));

  if (!zonesToApply.length) {
    throw new Error(
      onlyZone
        ? `Zone not in config zones[]: ${onlyZone}`
        : "No zones defined in config zones[]"
    );
  }

  log("listing Cloudflare zones");
  const allZones = await api.listZones();
  const zoneByName = new Map(allZones.map((z) => [z.name, z]));

  let overallOk = true;

  for (const name of zonesToApply) {
    const configZone = config.zonesByName.get(name);
    if (!configZone) continue;

    const cfZone = zoneByName.get(name);
    if (!cfZone) {
      pushWarning(reportCtx, `Configured zone not in Cloudflare account: ${name}`);
      recordStep(reportCtx, {
        id: `zone-${name}-dns`,
        title: `Sync DNS: ${name}`,
        ran: false,
        skipReason: "zone not in account",
        ok: false,
      });
      overallOk = false;
      continue;
    }

    if (!zonePassesFilter(name, config.zoneFilter)) {
      pushWarning(reportCtx, `Zone excluded by zone_filter: ${name}`);
      recordStep(reportCtx, {
        id: `zone-${name}-dns`,
        title: `Sync DNS: ${name}`,
        ran: false,
        skipReason: "zone_filter",
        ok: false,
      });
      overallOk = false;
      continue;
    }

    log(`zone ${name}: planning DNS sync (${configZone.records.length} desired records)`);
    const liveDns = await api.listDnsRecords(cfZone.id);
    let dnsPlan;
    try {
      dnsPlan = planZoneSync({
        desired: configZone.records,
        live: liveDns,
        zoneName: name,
        prune,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushWarning(reportCtx, `${name} DNS: ${msg}`);
      recordStep(reportCtx, {
        id: `zone-${name}-dns`,
        title: `Sync DNS: ${name}`,
        ran: true,
        ok: false,
        notes: [msg],
      });
      overallOk = false;
      continue;
    }

    log(
      `zone ${name}: DNS plan create=${dnsPlan.summary.create} update=${dnsPlan.summary.update} delete=${dnsPlan.summary.delete}`
    );

    const dnsApply = await applyZoneSync(api, cfZone.id, name, dnsPlan, {
      dryRun: reportCtx.dryRun,
      log,
    });

    recordStep(reportCtx, {
      id: `zone-${name}-dns`,
      title: `Sync DNS: ${name}`,
      ran: true,
      ok: dnsApply.ok,
      notes: [
        `create ${dnsPlan.summary.create}, update ${dnsPlan.summary.update}, delete ${dnsPlan.summary.delete}`,
        ...(dnsApply.results.filter((r) => !r.ok).map((r) => `${r.action} ${r.key}: ${r.error}`)),
      ],
    });
    if (!dnsApply.ok) overallOk = false;

    if (!skipPageRules && configZone.manages_page_rules) {
      log(`zone ${name}: planning page rules sync (${(configZone.page_rules ?? []).length} desired)`);
      let pagePlan;
      try {
        const livePageRules = await api.listPageRules(cfZone.id);
        pagePlan = planPageRuleSync(configZone.page_rules ?? [], livePageRules, prune);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushWarning(reportCtx, `${name} page rules: ${msg}`);
        recordStep(reportCtx, {
          id: `zone-${name}-page-rules`,
          title: `Sync page rules: ${name}`,
          ran: true,
          ok: false,
          notes: [msg],
        });
        overallOk = false;
        pagePlan = null;
      }

      if (pagePlan) {
        log(
          `zone ${name}: page rules plan create=${pagePlan.summary.create} update=${pagePlan.summary.update} delete=${pagePlan.summary.delete}`
        );
        const pageApply = await applyPageRuleSync(api, cfZone.id, pagePlan, {
          dryRun: reportCtx.dryRun,
          log,
        });
        recordStep(reportCtx, {
          id: `zone-${name}-page-rules`,
          title: `Sync page rules: ${name}`,
          ran: true,
          ok: pageApply.ok,
          notes: [
            `create ${pagePlan.summary.create}, update ${pagePlan.summary.update}, delete ${pagePlan.summary.delete}`,
            ...(pageApply.results.filter((r) => !r.ok).map((r) => `${r.action} ${r.key}: ${r.error}`)),
          ],
        });
        if (!pageApply.ok) overallOk = false;
      }
    }

    if (!skipEmailRouting && (configZone.manages_email_routing_rules || configZone.manages_email_routing_catch_all)) {
      let emailOk = true;
      /** @type {string[]} */
      const emailNotes = [];

      if (configZone.manages_email_routing_rules) {
        log(
          `zone ${name}: planning email routing rules sync (${(configZone.email_routing_rules ?? []).length} desired)`
        );
        try {
          const liveEmailRules = await api.listEmailRoutingRules(cfZone.id);
          const emailPlan = planEmailRoutingRuleSync(
            configZone.email_routing_rules ?? [],
            liveEmailRules,
            prune
          );
          log(
            `zone ${name}: email rules plan create=${emailPlan.summary.create} update=${emailPlan.summary.update} delete=${emailPlan.summary.delete}`
          );
          const emailApply = await applyEmailRoutingRuleSync(api, cfZone.id, emailPlan, {
            dryRun: reportCtx.dryRun,
            log,
          });
          emailNotes.push(
            `rules create ${emailPlan.summary.create}, update ${emailPlan.summary.update}, delete ${emailPlan.summary.delete}`
          );
          emailNotes.push(
            ...emailApply.results.filter((r) => !r.ok).map((r) => `${r.action} ${r.key}: ${r.error}`)
          );
          if (!emailApply.ok) emailOk = false;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          emailNotes.push(msg);
          emailOk = false;
        }
      }

      if (configZone.manages_email_routing_catch_all && configZone.email_routing?.catch_all) {
        log(`zone ${name}: planning email routing catch-all sync`);
        try {
          const liveCatchAll = await api.getEmailRoutingCatchAll(cfZone.id);
          const catchPlan = planCatchAllSync(configZone.email_routing.catch_all, liveCatchAll);
          if (catchPlan.update) {
            const catchApply = await applyCatchAllSync(api, cfZone.id, catchPlan, {
              dryRun: reportCtx.dryRun,
              log,
            });
            emailNotes.push(`catch-all update ${catchPlan.summary.update}`);
            emailNotes.push(
              ...catchApply.results.filter((r) => !r.ok).map((r) => `${r.action} ${r.key}: ${r.error}`)
            );
            if (!catchApply.ok) emailOk = false;
          } else {
            emailNotes.push("catch-all unchanged");
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          emailNotes.push(`catch-all: ${msg}`);
          emailOk = false;
        }
      }

      recordStep(reportCtx, {
        id: `zone-${name}-email-routing`,
        title: `Sync email routing: ${name}`,
        ran: true,
        ok: emailOk,
        notes: emailNotes,
      });
      if (!emailOk) overallOk = false;
    }
  }

  const snapshot = await collectCloudflareDnsState({
    config,
    api,
    zoneFilterName: zoneName,
  });
  if (snapshot.missing_configured_zones.length) {
    for (const z of snapshot.missing_configured_zones) {
      pushWarning(reportCtx, `Configured zone not in account: ${z}`);
    }
    overallOk = false;
  }

  setOutcome(reportCtx, { ok: overallOk, dryRun: reportCtx.dryRun, exitCode: overallOk ? 0 : 1 });
  setStdoutPayload(reportCtx, {
    managed_zones: snapshot.account_zones,
    missing_configured_zones: snapshot.missing_configured_zones,
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
