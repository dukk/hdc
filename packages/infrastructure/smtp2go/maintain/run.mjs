#!/usr/bin/env node
/**
 * SMTP2GO maintain: add missing sender domains and trigger verification.
 *
 * Usage: hdc run infrastructure smtp2go maintain --
 *   [--domain-id <id>] [--domain <fqdn>] [--dry-run] [--skip-verify]
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
import { createSmtp2goClient } from "../lib/smtp2go-api.mjs";
import { normalizeSmtp2goConfig } from "../lib/smtp2go-config.mjs";
import { collectSmtp2goState, fetchLiveSmtp2goState } from "../lib/smtp2go-collect.mjs";
import { applyDomainSync, planDomainSync } from "../lib/smtp2go-sync.mjs";
import { createSmtp2goVaultAccess, resolveSmtp2goApiKey } from "../lib/vault-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/infrastructure/smtp2go/config.example.json";

const MANIFEST_NEXT_STEPS = [
  "Run `hdc run infrastructure smtp2go query --` to verify sender domains and DNS checklists.",
  "Apply dns_checklist rows via Cloudflare or BIND, then re-run query until verified.",
];

/**
 * @param {string} line
 */
function log(line) {
  errout.write(`[smtp2go] ${line}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = parseArgvFlags(argv);
  const domainId = flagGet(flags, "domain-id");
  const domainFqdn = flagGet(flags, "domain");
  const skipVerify = flags["skip-verify"] === "1";

  const reportCtx = createOperationReportContext({
    packageId: "smtp2go",
    packageTitle: "SMTP2GO",
    verb,
    argv,
    manifestNextSteps: MANIFEST_NEXT_STEPS,
    extraFlags: { skipVerify },
  });

  log(
    `${verb}: starting${reportCtx.dryRun ? " (dry-run)" : ""}${skipVerify ? " (skip-verify)" : ""}`
  );

  const { data: cfgRaw, source } = loadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
    log: (line) => errout.write(line),
  });
  log(`config loaded (${source})`);

  const config = normalizeSmtp2goConfig(cfgRaw);
  const vault = createSmtp2goVaultAccess();
  const apiKey = await resolveSmtp2goApiKey(vault, config.apiKeyVaultKey);
  log(`API key loaded (${config.apiKeyVaultKey})`);

  const api = createSmtp2goClient({
    apiKey,
    apiBaseUrl: config.apiBase,
  });

  let live = await fetchLiveSmtp2goState(api, log);
  const liveByFqdn = new Map(
    live.senderDomains
      .map((row) => {
        const fqdn =
          typeof row.domain?.fulldomain === "string"
            ? row.domain.fulldomain.trim().toLowerCase()
            : "";
        return fqdn ? [fqdn, row] : null;
      })
      .filter(Boolean)
  );

  let entries = config.senderDomains.filter((d) => d.managed);
  if (domainId) {
    const one = config.domainsById.get(domainId);
    if (!one) throw new Error(`Domain id not in config sender_domains[]: ${domainId}`);
    if (!one.managed) throw new Error(`Domain is not managed: ${domainId}`);
    entries = [one];
  } else if (domainFqdn) {
    const fqdn = domainFqdn.trim().toLowerCase();
    const one = config.domainsByFqdn.get(fqdn);
    if (!one) throw new Error(`Domain not in config sender_domains[]: ${domainFqdn}`);
    if (!one.managed) throw new Error(`Domain is not managed: ${domainFqdn}`);
    entries = [one];
  }

  if (!entries.length) {
    pushWarning(reportCtx, "No managed sender_domains[] entries to maintain.");
  }

  let overallOk = true;

  for (const entry of entries) {
    const liveRow = liveByFqdn.get(entry.domain) ?? null;
    const plan = planDomainSync({
      entry,
      live: liveRow,
      defaults: config.defaults,
    });
    log(`domain ${entry.domain}: plan action=${plan.action}`);

    const applyResult = await applyDomainSync(api, plan, {
      dryRun: reportCtx.dryRun,
      skipVerify,
      log,
    });

    recordStep(reportCtx, {
      id: `domain-${entry.id}`,
      title: `Maintain: ${entry.domain}`,
      ran: plan.action !== "skip" && plan.action !== "unchanged",
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

  live = await fetchLiveSmtp2goState(api, log);

  const snapshot = collectSmtp2goState({
    config,
    live,
    domainIdFilter: domainId,
    domainFilter: domainFqdn,
  });

  for (const row of snapshot.sender_domains) {
    if (!row.managed || !row.verification) continue;
    const verification = /** @type {{ fully_verified?: boolean }} */ (row.verification);
    if (!verification.fully_verified) {
      pushWarning(
        reportCtx,
        `${row.domain}: DNS verification incomplete — apply dns_checklist and re-run query`
      );
      overallOk = false;
    }
  }

  const unverifiedDns = snapshot.sender_domains
    .filter((row) => row.managed && row.dns_checklist && row.dns_checklist.length)
    .map((row) => ({
      domain: row.domain,
      dns_checklist: row.dns_checklist,
    }));

  setOutcome(reportCtx, { ok: overallOk, dryRun: reportCtx.dryRun, exitCode: overallOk ? 0 : 1 });
  setStdoutPayload(reportCtx, {
    config_source: source,
    sender_domains: snapshot.sender_domains,
    extra_in_live: snapshot.extra_in_live,
    unverified_dns: unverifiedDns,
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
