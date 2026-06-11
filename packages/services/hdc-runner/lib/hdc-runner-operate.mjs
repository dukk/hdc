import { flagGet } from "../../../lib/parse-argv-flags.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { guestBaselineResultFields } from "../../../lib/guest-baseline-report.mjs";
import { syncExcludePatterns } from "./hdc-runner-settings.mjs";
import {
  configureHdcRunnerOnGuest,
  pruneStaleCronFiles,
} from "./hdc-runner-configure.mjs";
import {
  ensureHdcNpmDepsOnGuest,
  ensureOperatorSshKeysOnGuest,
  installHdcRunnerOnGuest,
} from "./hdc-runner-install.mjs";
import { ensureRunnerDirectories, syncHdcTreesToGuest } from "./hdc-runner-sync.mjs";
import {
  resolveRunnerConfigureExec,
  resolveRunnerGuestSsh,
} from "./resolve-guest-access.mjs";
import {
  createHdcRunnerVaultAccess,
  resolveVaultwardenMasterPassword,
} from "./vault-deps.mjs";

/**
 * @param {ReturnType<typeof import("./deployments.mjs").resolveHdcRunnerDeployments>[number]} deployment
 * @param {object} ctx
 * @param {string} ctx.root
 * @param {string} ctx.proxmoxRoot
 * @param {Record<string, string>} ctx.flags
 * @param {ReturnType<typeof createHdcRunnerVaultAccess>} ctx.vaultAccess
 * @param {boolean} ctx.runInstall
 * @param {boolean} ctx.dryRun
 */
export async function applyHdcRunnerOnDeployment(deployment, ctx) {
  const { root, proxmoxRoot, flags, vaultAccess, runInstall, dryRun } = ctx;
  const { systemId, mode, runner } = deployment;
  const log = provisionLogFromConsole(console);
  const exec = resolveRunnerConfigureExec(deployment, proxmoxRoot);

  /** @type {Record<string, unknown>} */
  const result = { system_id: systemId, mode };

  if (runInstall) {
    const installResult = installHdcRunnerOnGuest(exec, runner, log);
    result.install = installResult;
    if (!installResult.ok) {
      return { ...result, ok: false, message: installResult.message };
    }
    ensureRunnerDirectories(exec, runner);
  }

  const baselineFlags = {
    ...flags,
    "skip-clamav": "",
    "skip-clamav-scan": "",
  };
  const baseline = await ensureGuestLinuxBaseline({
    exec,
    log,
    flags: baselineFlags,
    vaultAccess,
    deployment: deployment.raw,
    proxmoxPackageRoot: proxmoxRoot,
  });
  result.baseline = guestBaselineResultFields(baseline);
  if (!baseline.ok) {
    return { ...result, ok: false, message: "guest baseline failed" };
  }

  const keysResult = ensureOperatorSshKeysOnGuest(exec, log);
  result.operator_ssh_keys = keysResult;

  const skipSync = flagGet(flags, "skip-sync", "skip_sync") !== undefined;
  if (!skipSync) {
    const guestSsh = resolveRunnerGuestSsh(deployment, proxmoxRoot);
    const syncResult = syncHdcTreesToGuest({
      publicRoot: root,
      remoteUser: guestSsh.user,
      remoteHost: guestSsh.host,
      remotePort: guestSsh.port,
      installRoot: runner.install_root,
      privateRoot: runner.private_root,
      exclude: syncExcludePatterns(runner),
      dryRun,
      log,
    });
    result.sync = syncResult;
    if (!syncResult.ok) {
      return { ...result, ok: false, message: syncResult.message };
    }

    if (!dryRun) {
      const npmResult = ensureHdcNpmDepsOnGuest(exec, runner.install_root, log);
      result.npm_deps = npmResult;
      if (!npmResult.ok) {
        return { ...result, ok: false, message: npmResult.message };
      }
    }
  } else {
    result.sync = { ok: true, skipped: true, message: "skipped by flag" };
  }

  if (dryRun) {
    return { ...result, ok: true, message: "dry-run (configure skipped)" };
  }

  /** @type {Record<string, string>} */
  const envMap = {};
  for (const [key, val] of Object.entries(runner.env)) {
    if (typeof key === "string" && key.trim() && val !== undefined && val !== null) {
      envMap[key.trim()] = String(val);
    }
  }

  try {
    const masterPassword = await resolveVaultwardenMasterPassword(vaultAccess);
    envMap.HDC_VAULTWARDEN_MASTER_PASSWORD = masterPassword;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...result, ok: false, message: `vault: ${msg}` };
  }

  const configureResult = configureHdcRunnerOnGuest(exec, runner, envMap, log);
  result.configure = configureResult;
  if (!configureResult.ok) {
    return { ...result, ok: false, message: configureResult.message };
  }

  if (flagGet(flags, "prune") !== undefined) {
    result.prune = pruneStaleCronFiles(exec, runner);
  }

  return {
    ...result,
    ok: configureResult.ok,
    message: configureResult.message,
  };
}
