#!/usr/bin/env node
/**
 * Re-apply step-ca configuration; optional package upgrade.
 *
 * Usage: hdc run service step-ca maintain -- [--instance a] [--skip-package-upgrade] [--skip-clamav] [--skip-disk-resize]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { syncQemuRootfsOnMaintain } from "../../../lib/qemu-rootfs-resize.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { configureStepCaServer, createConfigureExec } from "../lib/step-ca-configure.mjs";
import { aptInstallStepCaCommand } from "../lib/step-ca-install.mjs";
import {
  normalizeStepCaConfig,
  resolveStepCaDeployments,
  stepCaGlobalSettings,
} from "../lib/deployments.mjs";
import { caPasswordVaultKey, instanceLetterFromSystemId } from "../lib/inventory.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { createStepCaVaultAccess } from "../lib/vault-deps.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/step-ca/config.example.json";
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
const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: step-ca maintain (stderr log; JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});
  const skipUpgrade = flagGet(flags, "skip-package-upgrade") !== undefined;

  let normalized;
  let toMaintain;
  try {
    normalized = normalizeStepCaConfig(cfg);
    toMaintain = resolveStepCaDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const global = stepCaGlobalSettings(normalized);
  const vault = createStepCaVaultAccess();
  await vault.unlock({});

  const stepCaBlock = isObject(normalized.stepCa) ? normalized.stepCa : {};
  const log = provisionLogFromConsole(console);
  /** @type {Record<string, unknown>[]} */
  const results = [];

  for (const deployment of toMaintain) {
    const cfgSsh = deployment.configure;
    const ssh = isObject(cfgSsh) && isObject(cfgSsh.ssh) ? cfgSsh.ssh : {};
    const user = typeof ssh.user === "string" ? ssh.user : "root";
    const host = typeof ssh.host === "string" ? ssh.host : "";
    if (!host) {
      results.push({ ok: false, system_id: deployment.systemId, message: "missing ssh host" });
      continue;
    }

    errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} at ${user}@${host} …\n`);

    /** @type {Record<string, unknown> | undefined} */
    let diskResize;
    if (deployment.mode === "proxmox-qemu") {
      errout.write(`[hdc] ${target} ${verb}: disk resize check on ${deployment.systemId} …\n`);
      try {
        diskResize = await syncQemuRootfsOnMaintain({
          proxmoxPackageRoot: proxmoxRoot,
          deployment,
          flags,
          log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
        });
      } catch (e) {
        const msg = String(/** @type {Error} */ (e).message || e);
        errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} disk resize failed: ${msg}\n`);
        results.push({ ok: false, system_id: deployment.systemId, message: msg });
        continue;
      }
    }

    const letter = instanceLetterFromSystemId(deployment.systemId);
    const pwKey = caPasswordVaultKey(stepCaBlock, letter);
    const caPassword = String(
      await vault.getSecret(pwKey, { promptLabel: `vault secret ${pwKey}` }),
    ).trim();
    if (!caPassword) {
      results.push({ ok: false, system_id: deployment.systemId, message: `missing ${pwKey}` });
      continue;
    }

    const exec = createConfigureExec("ssh", { user, host });

    try {
      if (!skipUpgrade) {
        errout.write(`[hdc] ${target} ${verb}: upgrading step-ca packages on ${deployment.systemId} …\n`);
        exec.run(aptInstallStepCaCommand(), { capture: true });
      }

      const configure = await configureStepCaServer({
        exec,
        log,
        global,
        caPassword,
        skipPackageInstall: true,
        restartService: true,
      });
      const baseline = await ensureGuestLinuxBaseline({ exec, log, flags, vaultAccess, deployment, proxmoxPackageRoot: proxmoxRoot });
      results.push({
        ok: baseline.ok,
        system_id: deployment.systemId,
        role: deployment.role,
        ...(diskResize ? { disk_resize: diskResize } : {}),
        configure,
        admin_user: baseline.admin_user,
        clamav: baseline.clamav,
      });
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      results.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  const ok = results.length > 0 && results.every((r) => r.ok);
  process.stdout.write(
    `${JSON.stringify({ ok, target, verb, results, generated_at: new Date().toISOString() }, null, 2)}\n`,
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
