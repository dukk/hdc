#!/usr/bin/env node
/**
 * Maintain nginx web nodes: push site configs, optional cert renew.
 *
 * Usage: hdc run service nginx maintain -- [--renew-certs] [--site <id>] [--skip-clamav]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { createNginxVaultAccess } from "../lib/vault-deps.mjs";
import {
  nginxGlobalSettings,
  normalizeNginxConfig,
  resolveNginxDeployments,
  resolveSites,
  sshTargetFromDeployment,
} from "../lib/deployments.mjs";
import { configureNginxSites, createConfigureExec } from "../lib/nginx-configure.mjs";
import { obtainMissingCertificates, queryCertExpiry, renewCertificates } from "../lib/letsencrypt.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { tlsDomainsFromSites } from "../lib/nginx-render.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/nginx/config.example.json";
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

const target = basename(dirname(here));
const verb = basename(here);

/**
 * @param {ReturnType<typeof nginxGlobalSettings>} global
 * @param {Awaited<ReturnType<typeof createNginxVaultAccess>>} vault
 */
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
  errout.write(`[hdc] ${target} ${verb}: nginx site sync and certificates (JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});
  const renewCerts = flagGet(flags, "renew-certs") !== undefined;
  const siteFilter = flagGet(flags, "site");

  let normalized;
  let deployments;
  try {
    normalized = normalizeNginxConfig(cfg);
    deployments = resolveNginxDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const global = nginxGlobalSettings(normalized);
  const partialSiteUpdate = Boolean(siteFilter);
  const sites = /** @type {Record<string, unknown>[]} */ (
    siteFilter ? resolveSites(cfg, siteFilter) : global.sites
  );
  if (partialSiteUpdate) {
    errout.write(
      `[hdc] ${target} ${verb}: updating site ${JSON.stringify(siteFilter)} only (other vhosts unchanged)\n`,
    );
  }

  const vault = createNginxVaultAccess();
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

  if (!renewCerts) {
    for (const deployment of deployments) {
      errout.write(`[hdc] ${target} ${verb}: pushing sites to ${deployment.systemId} …\n`);
      try {
        const { user, host } = sshTargetFromDeployment(deployment);
        const exec = createConfigureExec("ssh", { user, host });
        const configure = configureNginxSites({
          exec,
          log,
          global,
          sites,
          pruneStaleSites: !partialSiteUpdate,
        });
        results.push({
          ok: true,
          system_id: deployment.systemId,
          configure,
        });
      } catch (e) {
        const msg = String(/** @type {Error} */ (e).message || e);
        results.push({ ok: false, system_id: deployment.systemId, message: msg });
      }
    }
  }

  if (renewCerts) {
    for (const deployment of deployments) {
      errout.write(`[hdc] ${target} ${verb}: renewing certificates on ${deployment.systemId} …\n`);
      try {
        if (!email) throw new Error("Let's Encrypt email required");
        const { user, host } = sshTargetFromDeployment(deployment);
        const exec = createConfigureExec("ssh", { user, host });
        renewCertificates({ exec, log });
        const certResult = obtainMissingCertificates({
          exec,
          log,
          global,
          email,
          sites,
          tsigSecret,
        });
        configureNginxSites({ exec, log, global, sites });
        results.push({
          ok: true,
          system_id: deployment.systemId,
          step: "renew-certs",
          certificates: certResult,
        });
      } catch (e) {
        const msg = String(/** @type {Error} */ (e).message || e);
        results.push({ ok: false, system_id: deployment.systemId, step: "renew-certs", message: msg });
      }
    }
  }

  const domains = tlsDomainsFromSites(sites);
  const allDeployments = resolveNginxDeployments(cfg, {});
  for (const deployment of allDeployments) {
    errout.write(`[hdc] ${target} ${verb}: ClamAV on ${deployment.systemId} …\n`);
    try {
      const { user, host } = sshTargetFromDeployment(deployment);
      const exec = createConfigureExec("ssh", { user, host });
      const baseline = await ensureGuestLinuxBaseline({ exec, log, flags, vaultAccess });
      const existing = results.find((r) => r.system_id === deployment.systemId);
      if (existing) {
        existing.clamav = clamav;
        if (existing.ok !== false) existing.ok = clamav.ok;
      } else {
        results.push({ ok: baseline.ok, system_id: deployment.systemId, clamav });
      }
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      const existing = results.find((r) => r.system_id === deployment.systemId);
      if (existing) {
        existing.clamav = { ok: false, skipped: false, message: msg };
        existing.ok = false;
      } else {
        results.push({ ok: false, system_id: deployment.systemId, clamav: { ok: false, skipped: false, message: msg } });
      }
    }
  }

  /** @type {Record<string, unknown>[]} */
  const certStatus = [];
  for (const deployment of allDeployments) {
    const exec = createConfigureExec("ssh", sshTargetFromDeployment(deployment));
    for (const domain of domains) {
      certStatus.push({
        system_id: deployment.systemId,
        ...queryCertExpiry(exec, domain),
      });
    }
  }

  const ok = results.length === 0 || results.every((r) => r.ok !== false);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        target,
        verb,
        results,
        certificates: certStatus,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
