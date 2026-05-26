#!/usr/bin/env node
/**
 * Maintain nginx WAF: push site configs, optional cert renew/sync.
 *
 * Usage: hdc run service nginx-waf maintain -- [--sync-certs] [--renew-certs] [--site <id>] [--skip-clamav]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { createNginxWafVaultAccess } from "../lib/vault-deps.mjs";
import {
  findCertPrimaryDeployment,
  findPeerDeployment,
  nginxWafGlobalSettings,
  normalizeNginxWafConfig,
  resolveNginxWafDeployments,
  resolveSites,
  sshTargetFromDeployment,
} from "../lib/deployments.mjs";
import { configureNginxWafSites, maintainModsecurityCrs } from "../lib/nginx-waf-configure.mjs";
import { configureExecFromDeployment } from "../lib/configure-exec.mjs";
import { runCertSync } from "../lib/cert-sync.mjs";
import { obtainMissingCertificates, queryCertExpiry, renewCertificates } from "../lib/letsencrypt.mjs";
import { tlsDomainsFromSites } from "../lib/nginx-waf-render.mjs";
import { certExistsOnHost } from "../lib/letsencrypt.mjs";
import { nginxWafReportExtraSections } from "../lib/nginx-waf-report.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/nginx-waf/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}
function readCfg() {
  return ensurePackageConfig().data;
}
function tryCfg() {
  return tryLoadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
}

const root = repoRoot();

async function loadSecrets(global, vault) {
  let leEmail = global.email;
  if (!leEmail) {
    leEmail = String(
      await vault.getSecret(global.emailVaultKey, {
        promptLabel: `vault secret ${global.emailVaultKey}`,
      }),
    ).trim();
  }
  let tsigSecret = "";
  if (global.challenge === "dns-01") {
    tsigSecret = String(
      await vault.getSecret(global.dnsTsigVaultKey, {
        promptLabel: `vault secret ${global.dnsTsigVaultKey}`,
      }),
    ).trim();
  }
  return { email: leEmail, tsigSecret };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: nginx WAF site sync and certificates (JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});
  const syncCerts = flagGet(flags, "sync-certs") !== undefined;
  const renewCerts = flagGet(flags, "renew-certs") !== undefined;
  const siteFilter = flagGet(flags, "site");

  let normalized;
  let deployments;
  try {
    normalized = normalizeNginxWafConfig(cfg);
    deployments = resolveNginxWafDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const global = nginxWafGlobalSettings(normalized);
  const sites = /** @type {Record<string, unknown>[]} */ (
    siteFilter ? resolveSites(cfg, siteFilter) : global.sites
  );

  const vault = createNginxWafVaultAccess();
  const needVault = renewCerts || global.challenge === "dns-01" || !global.email;
  if (needVault) {
    await vault.unlock({});
  }
  const { email, tsigSecret } = needVault
    ? await loadSecrets(global, vault)
    : { email: global.email, tsigSecret: "" };

  const log = provisionLogFromConsole(console);
  /** @type {Record<string, unknown>[]} */
  const results = [];

  if (!syncCerts && !renewCerts) {
    for (const deployment of deployments) {
      errout.write(`[hdc] ${target} ${verb}: pushing sites to ${deployment.systemId} …\n`);
      try {
        const exec = configureExecFromDeployment(deployment);
        const siteNeedsWaf = sites.some((s) => {
          const waf = s && typeof s === "object" && s.waf && typeof s.waf === "object" ? s.waf : {};
          return waf.enabled !== false;
        });
        const modsecurity =
          global.modsecurityEnabled && siteNeedsWaf
            ? maintainModsecurityCrs({ exec, log, global })
            : { configured: false, skipped: true };
        let configure = configureNginxWafSites({ exec, log, global, sites });
        const missingTls = tlsDomainsFromSites(sites).filter((d) => !certExistsOnHost(exec, d));
        if (missingTls.length && email) {
          errout.write(
            `[hdc] ${target} ${verb}: obtaining certificate(s) ${missingTls.join(", ")} on ${deployment.systemId} …\n`,
          );
          obtainMissingCertificates({
            exec,
            log,
            global,
            email,
            sites,
            tsigSecret,
          });
          configure = configureNginxWafSites({ exec, log, global, sites });
        }
        results.push({
          ok: true,
          system_id: deployment.systemId,
          role: deployment.role,
          modsecurity,
          configure,
        });
      } catch (e) {
        const msg = String(/** @type {Error} */ (e).message || e);
        results.push({ ok: false, system_id: deployment.systemId, message: msg });
      }
    }
  }

  const allDeployments = resolveNginxWafDeployments(cfg, {});
  const primary = findCertPrimaryDeployment(allDeployments, global.certPrimarySystemId);
  const peer = findPeerDeployment(allDeployments, primary);
  const primaryExec = configureExecFromDeployment(primary);

  if (renewCerts) {
    errout.write(`[hdc] ${target} ${verb}: renewing certificates on ${primary.systemId} …\n`);
    try {
      if (!email) throw new Error("Let's Encrypt email required");
      renewCertificates({ exec: primaryExec, log });
      obtainMissingCertificates({
        exec: primaryExec,
        log,
        global,
        email,
        sites,
        tsigSecret,
      });
      if (peer) runCertSync(primaryExec, log);
      results.push({
        ok: true,
        system_id: primary.systemId,
        step: "renew-certs",
        synced_to: peer?.systemId ?? null,
      });
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      results.push({ ok: false, system_id: primary.systemId, step: "renew-certs", message: msg });
    }
  } else if (syncCerts && peer) {
    errout.write(`[hdc] ${target} ${verb}: syncing certificates to ${peer.systemId} …\n`);
    try {
      runCertSync(primaryExec, log);
      results.push({ ok: true, system_id: primary.systemId, step: "sync-certs", synced_to: peer.systemId });
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      results.push({ ok: false, system_id: primary.systemId, step: "sync-certs", message: msg });
    }
  }

  for (const deployment of allDeployments) {
    errout.write(`[hdc] ${target} ${verb}: ClamAV on ${deployment.systemId} …\n`);
    try {
      const cfg = deployment.configure;
      const via =
        cfg && typeof cfg.via === "string" && cfg.via.trim() ? cfg.via.trim().toLowerCase() : "ssh";
      if (via === "qemu-guest") {
        continue;
      }
      const exec = configureExecFromDeployment(deployment);
      const baseline = await ensureGuestLinuxBaseline({ exec, log, flags, vaultAccess });
      const existing = results.find((r) => r.system_id === deployment.systemId);
      if (existing) {
        existing.clamav = baseline.clamav;
        if (existing.ok !== false) existing.ok = baseline.ok;
      } else {
        results.push({
          ok: baseline.ok,
          system_id: deployment.systemId,
          role: deployment.role,
          clamav: baseline.clamav,
        });
      }
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      const existing = results.find((r) => r.system_id === deployment.systemId);
      if (existing) {
        existing.clamav = { ok: false, skipped: false, message: msg };
        existing.ok = false;
      } else {
        results.push({
          ok: false,
          system_id: deployment.systemId,
          clamav: { ok: false, skipped: false, message: msg },
        });
      }
    }
  }

  const domains = tlsDomainsFromSites(sites);
  /** @type {Record<string, unknown>[]} */
  const certStatus = [];
  for (const deployment of allDeployments) {
    const exec = configureExecFromDeployment(deployment);
    for (const domain of domains) {
      certStatus.push({
        system_id: deployment.systemId,
        ...queryCertExpiry(exec, domain),
      });
    }
  }

  const ok = results.length === 0 || results.every((r) => r.ok !== false);
  const payload = {
    ok,
    target,
    verb,
    results,
    certificates: certStatus,
    generated_at: new Date().toISOString(),
  };
  runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    extraSections: nginxWafReportExtraSections,
  });
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
