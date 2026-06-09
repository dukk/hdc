#!/usr/bin/env node
import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
import { guestBaselineResultFields, guestBaselineUsersOk } from "../../../lib/guest-baseline-report.mjs";
/**
 * Maintain Immich: re-push .env, refresh Docker images, optional ClamAV.
 *
 * Usage: hdc run service immich maintain -- [--instance a | --system-id immich-a]
 *        [--skip-upgrade] [--skip-admin-sync] [--test-email <addr>] [--skip-clamav]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { createConfigureExec } from "../../postfix-relay/lib/postfix-relay-configure.mjs";
import {
  dataDiskGbFromDeployment,
  dbPasswordVaultKey,
  normalizeImmichConfig,
  resolveImmichDeployments,
} from "../lib/deployments.mjs";
import { maintainImmichOnHost } from "../lib/immich-install.mjs";
import { maintainImmichOnSynology } from "../lib/immich-synology.mjs";
import { createImmichVaultAccess } from "../lib/vault-deps.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { syncImmichAdminConfig } from "../lib/immich-admin-sync.mjs";
import { mailBlockFromService } from "../../../lib/app-mail-render.mjs";
import { mailEnabledFromConfig } from "../../../lib/mail-relay-settings.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/immich/config.example.json";
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

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Immich maintain (stderr log; JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});
  const skipUpgrade = flagGet(flags, "skip-upgrade") !== undefined;
  const skipAdminSync = flagGet(flags, "skip-admin-sync") !== undefined;
  const testEmail = flagGet(flags, "test-email");

  let toMaintain;
  try {
    normalizeImmichConfig(cfg);
    toMaintain = resolveImmichDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const vault = createImmichVaultAccess();
  await vault.unlock({});

  const log = provisionLogFromConsole(console);
  /** @type {Record<string, unknown>[]} */
  const results = [];

  for (const deployment of toMaintain) {
    const dbKey = dbPasswordVaultKey(deployment.immich);
    const dbPassword = String(
      await vault.getSecret(dbKey, { promptLabel: `vault secret ${dbKey}` }),
    ).trim();
    if (!dbPassword) {
      results.push({ ok: false, system_id: deployment.systemId, message: `missing ${dbKey}` });
      continue;
    }

    try {
      if (deployment.mode === "synology-docker") {
        errout.write(
          `[hdc] ${target} ${verb}: ${deployment.systemId} synology-docker (instance ${JSON.stringify(deployment.synology?.instance ?? "a")}) …\n`,
        );
        const maintain = await maintainImmichOnSynology(deployment, dbPassword, { skipUpgrade });
        results.push({
          ok: maintain.ok !== false,
          system_id: deployment.systemId,
          mode: deployment.mode,
          maintain,
        });
        continue;
      }

      const cfgSsh = deployment.configure;
      const ssh = isObject(cfgSsh) && isObject(cfgSsh.ssh) ? cfgSsh.ssh : {};
      const user = resolveGuestSshUser(ssh.user);
      const host = typeof ssh.host === "string" ? ssh.host : "";
      if (!host) {
        results.push({ ok: false, system_id: deployment.systemId, message: "missing ssh host" });
        continue;
      }

      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} at ${user}@${host} …\n`);
      const exec = createConfigureExec("ssh", { user, host });
      const dataDiskGb = dataDiskGbFromDeployment(deployment);

      const maintain = await maintainImmichOnHost(exec, deployment.immich, deployment.install, dbPassword, {
        skipUpgrade,
        dataDiskGb,
      });

      /** @type {Record<string, unknown> | null} */
      let adminSync = null;
      const immichBlock = deployment.immich;
      const hasAdminPayload =
        isObject(immichBlock?.system_config) ||
        mailEnabledFromConfig(mailBlockFromService(immichBlock)) ||
        (typeof immichBlock?.public_url === "string" && immichBlock.public_url.trim());

      if (!skipAdminSync && hasAdminPayload) {
        try {
          adminSync = await syncImmichAdminConfig({
            vault,
            immich: immichBlock,
            sshHost: host,
            testEmail: testEmail || null,
            log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
          });
        } catch (e) {
          const msg = String(/** @type {Error} */ (e).message || e);
          errout.write(`[hdc] ${target} ${verb}: admin sync failed: ${msg}\n`);
          adminSync = { ok: false, message: msg };
        }
      } else if (skipAdminSync) {
        adminSync = { ok: true, skipped: true, message: "--skip-admin-sync" };
      }

      const baseline = await ensureGuestLinuxBaseline({ exec, log, flags, vaultAccess, deployment, proxmoxPackageRoot: proxmoxRoot });
      const adminOk = !adminSync || adminSync.ok !== false;
      results.push({
        ok: maintain.ok && baseline.clamav.ok && adminOk,
        system_id: deployment.systemId,
        maintain,
        admin_sync: adminSync,
        ...guestBaselineResultFields(baseline),
      });
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      results.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  const ok = results.length > 0 && results.every((r) => r.ok);
  const payload = { ok, target, verb, results, generated_at: new Date().toISOString() };
  runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
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

