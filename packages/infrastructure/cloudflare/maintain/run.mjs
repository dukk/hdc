#!/usr/bin/env node
/**
 * Cloudflare DNS maintain: apply config records to managed zones.
 *
 * Usage: hdc run infrastructure cloudflare maintain --
 *   [--zone <name>] [--dry-run] [--prune] [--no-report] [--report <path>]
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
import { createCloudflareVaultAccess, resolveCloudflareToken } from "../lib/vault-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/infrastructure/cloudflare/config.example.json";

const MANIFEST_NEXT_STEPS = [
  "Run `hdc run infrastructure cloudflare query --` to verify diffs after maintain.",
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

  const reportCtx = createOperationReportContext({
    packageId: "cloudflare",
    packageTitle: "Cloudflare DNS",
    verb,
    argv,
    manifestNextSteps: MANIFEST_NEXT_STEPS,
    extraFlags: { prune },
  });

  log(`${verb}: starting${reportCtx.dryRun ? " (dry-run)" : ""}${prune ? " (prune)" : ""}`);

  const { data: cfgRaw, source } = loadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const config = normalizeCloudflareConfig(cfgRaw);
  const vault = createCloudflareVaultAccess();
  const token = await resolveCloudflareToken(vault);
  log(`vault: HDC_CLOUDFLARE_API_TOKEN loaded`);

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
        id: `zone-${name}`,
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
        id: `zone-${name}`,
        title: `Sync DNS: ${name}`,
        ran: false,
        skipReason: "zone_filter",
        ok: false,
      });
      overallOk = false;
      continue;
    }

    log(`zone ${name}: planning sync (${configZone.records.length} desired records)`);
    const live = await api.listDnsRecords(cfZone.id);
    let plan;
    try {
      plan = planZoneSync({
        desired: configZone.records,
        live,
        zoneName: name,
        prune,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushWarning(reportCtx, `${name}: ${msg}`);
      recordStep(reportCtx, {
        id: `zone-${name}`,
        title: `Sync DNS: ${name}`,
        ran: true,
        ok: false,
        notes: [msg],
      });
      overallOk = false;
      continue;
    }

    log(
      `zone ${name}: plan create=${plan.summary.create} update=${plan.summary.update} delete=${plan.summary.delete}`
    );

    const applyResult = await applyZoneSync(api, cfZone.id, name, plan, {
      dryRun: reportCtx.dryRun,
      log,
    });

    recordStep(reportCtx, {
      id: `zone-${name}`,
      title: `Sync DNS: ${name}`,
      ran: true,
      ok: applyResult.ok,
      notes: [
        `create ${plan.summary.create}, update ${plan.summary.update}, delete ${plan.summary.delete}`,
        ...(applyResult.results.filter((r) => !r.ok).map((r) => `${r.action} ${r.key}: ${r.error}`)),
      ],
    });

    if (!applyResult.ok) overallOk = false;
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
