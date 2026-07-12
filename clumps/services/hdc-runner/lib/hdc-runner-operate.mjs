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
  ensureHdcAppNpmDepsOnGuest,
  ensureHdcNpmDepsOnGuest,
  ensureOperatorSshKeysOnGuest,
  ensureCronServiceOnGuest,
  installHdcRunnerOnGuest,
} from "./hdc-runner-install.mjs";
import { ensureRunnerDirectories, syncHdcTreesToGuest } from "./hdc-runner-sync.mjs";
import {
  ensureAgentGuestDirectories,
  ensureCursorCliOnGuest,
  syncAgentBundleToGuest,
} from "./hdc-runner-sync-agents.mjs";
import {
  runGuestDiscordTest,
  runGuestScheduleTest,
} from "./hdc-runner-guest-test.mjs";
import {
  resolveRunnerConfigureExec,
  resolveRunnerGuestSsh,
} from "./resolve-guest-access.mjs";
import {
  createHdcRunnerVaultAccess,
  resolveVaultwardenApiKeyCredentials,
  resolveVaultwardenMasterPassword,
} from "./vault-deps.mjs";
import {
  ensureRunnerOutboundSshKeyOnGuest,
  installRunnerPubKeyOnSshTargets,
  resolveNginxWafSshTargets,
} from "./hdc-runner-ssh-access.mjs";
import { resolveHdcRunnerUiSecrets, resolvePaperclipBridgeSecret, resolveCursorApiKey } from "./vault-secrets.mjs";

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

  const testDiscord = flagGet(flags, "test-discord", "test_discord") !== undefined;
  const testSchedule = flagGet(flags, "test-schedule", "test_schedule");

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

  const runnerKeyResult = ensureRunnerOutboundSshKeyOnGuest(exec, log);
  result.runner_outbound_ssh = runnerKeyResult;
  if (!runnerKeyResult.ok) {
    return { ...result, ok: false, message: runnerKeyResult.message };
  }

  if (!dryRun && runnerKeyResult.public_key) {
    const wafTargets = resolveNginxWafSshTargets(root);
    const propagateResult = installRunnerPubKeyOnSshTargets(
      runnerKeyResult.public_key,
      wafTargets,
      log,
    );
    result.runner_ssh_targets = propagateResult;
    if (!propagateResult.ok && !propagateResult.skipped) {
      return { ...result, ok: false, message: propagateResult.message };
    }
  }

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

      const appNpmResult = ensureHdcAppNpmDepsOnGuest(exec, runner.install_root, log);
      result.app_npm_deps = appNpmResult;
      if (!appNpmResult.ok) {
        return { ...result, ok: false, message: appNpmResult.message };
      }

      if (runner.agents?.enabled !== false) {
        const agentDirs = ensureAgentGuestDirectories(exec, runner);
        result.agent_directories = agentDirs;
        if (!agentDirs.ok) {
          return { ...result, ok: false, message: agentDirs.message };
        }

        const agentSync = syncAgentBundleToGuest({
          publicRoot: root,
          remoteUser: guestSsh.user,
          remoteHost: guestSsh.host,
          remotePort: guestSsh.port,
          installRoot: runner.install_root,
          dryRun: false,
          log,
        });
        result.agent_bundle_sync = agentSync;
        if (!agentSync.ok) {
          return { ...result, ok: false, message: agentSync.message };
        }
      }
    }
  } else {
    result.sync = { ok: true, skipped: true, message: "skipped by flag" };
  }

  if (dryRun) {
    return { ...result, ok: true, message: "dry-run (configure skipped)" };
  }

  const cronResult = ensureCronServiceOnGuest(exec, log);
  result.cron_service = cronResult;
  if (!cronResult.ok) {
    return { ...result, ok: false, message: cronResult.message };
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

  try {
    const apiKeyCreds = await resolveVaultwardenApiKeyCredentials(vaultAccess, { envMap });
    if (apiKeyCreds) {
      envMap.HDC_VAULTWARDEN_KEY_CLIENT_ID = apiKeyCreds.clientId;
      envMap.HDC_VAULTWARDEN_KEY_CLIENT_SECRET = apiKeyCreds.clientSecret;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...result, ok: false, message: `vaultwarden api key: ${msg}` };
  }

  try {
    const webhookUrl = await vaultAccess.getSecret("HDC_OPS_DISCORD_WEBHOOK_URL", { optional: true });
    if (webhookUrl) {
      envMap.HDC_OPS_DISCORD_WEBHOOK_URL = String(webhookUrl).trim();
    }
  } catch {
    /* optional — Discord falls back to guest bw when absent */
  }

  if (runner.web.enabled !== false) {
    try {
      const uiSecrets = await resolveHdcRunnerUiSecrets(vaultAccess, runner.web);
      if (uiSecrets.uiPassword) envMap.HDC_HDC_RUNNER_UI_PASSWORD = uiSecrets.uiPassword;
      if (uiSecrets.sessionSecret) envMap.HDC_HDC_RUNNER_UI_SESSION_SECRET = uiSecrets.sessionSecret;
      if (uiSecrets.apiToken) envMap.HDC_HDC_RUNNER_API_TOKEN = uiSecrets.apiToken;
      result.ui_secrets = { vault_keys: uiSecrets.vaultKeys };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ...result, ok: false, message: `web UI secrets: ${msg}` };
    }
  }

  if (runner.paperclip_bridge?.enabled) {
    try {
      const bridgeSecrets = await resolvePaperclipBridgeSecret(vaultAccess, runner.paperclip_bridge);
      if (bridgeSecrets.bridgeSecret) {
        envMap.HDC_PAPERCLIP_BRIDGE_SECRET = bridgeSecrets.bridgeSecret;
      }
      result.bridge_secrets = { vault_key: bridgeSecrets.vaultKey };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ...result, ok: false, message: `paperclip bridge secret: ${msg}` };
    }
  }

  if (runner.agents?.enabled !== false) {
    try {
      const cursorSecrets = await resolveCursorApiKey(vaultAccess, runner.agents);
      if (cursorSecrets.apiKey) {
        envMap.CURSOR_API_KEY = cursorSecrets.apiKey;
      }
      envMap.HDC_RUNNER_MAX_AGENT_RUNS = String(runner.agents.max_concurrent_agent_runs ?? 1);
      result.agent_secrets = { vault_key: cursorSecrets.vaultKey };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ...result, ok: false, message: `cursor api key: ${msg}` };
    }
  }

  if (runner.agents?.enabled !== false && !dryRun) {
    const cursorCli = ensureCursorCliOnGuest(exec, log);
    result.cursor_cli = cursorCli;
    if (!cursorCli.ok) {
      return { ...result, ok: false, message: cursorCli.message };
    }
    ensureAgentGuestDirectories(exec, runner);
  }

  const skipUi = flagGet(flags, "skip-ui", "skip_ui") !== undefined;
  const skipBridge = flagGet(flags, "skip-bridge", "skip_bridge") !== undefined;
  const configureResult = configureHdcRunnerOnGuest(exec, runner, envMap, log, {
    systemId,
    skipUi,
    skipBridge,
  });
  result.configure = configureResult;
  if (!configureResult.ok) {
    return { ...result, ok: false, message: configureResult.message };
  }

  if (flagGet(flags, "prune") !== undefined) {
    result.prune = pruneStaleCronFiles(exec, runner);
  }

  if (testDiscord) {
    result.test_discord = runGuestDiscordTest(exec, runner, log);
  }
  if (testSchedule) {
    result.test_schedule = runGuestScheduleTest(exec, runner, testSchedule, log);
  }

  const testFailed =
    (testDiscord && result.test_discord?.ok === false) ||
    (testSchedule && result.test_schedule?.ok === false);

  return {
    ...result,
    ok: configureResult.ok && !testFailed,
    message: testFailed ? "test failed" : configureResult.message,
  };
}
