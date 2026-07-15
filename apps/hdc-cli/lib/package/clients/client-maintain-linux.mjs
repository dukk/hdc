import {
  discoverLocalSshMaterial,
  sshReachableWithPubkey,
  sshSpawn,
} from "../../ssh-host-access.mjs";
import { createConfigureExec } from "hdc/clump/services/postfix-relay/lib/postfix-relay-configure.mjs";
import { provisionLogFromConsole } from "../host-provisioner.mjs";
import { ensurePostfixSatellite } from "../postfix-satellite-ensure.mjs";

/**
 * @param {{ user: string; host: string }} target
 * @param {typeof import("node:child_process").spawnSync} spawnSync
 * @param {NodeJS.ProcessEnv} env
 * @param {typeof import('../../ssh-host-access.mjs").discoverLocalSshMaterial} identities
 */
function sshExec(target, remoteArgv, spawnSync, env, identities, timeoutMs = 600_000) {
  return sshSpawn(target, remoteArgv, {
    spawnSync,
    env,
    mode: "pubkey",
    identities,
    timeoutMs,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} opts
 * @param {{ user: string; host: string }} opts.target
 * @param {typeof import("node:child_process").spawnSync} opts.spawnSync
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {boolean} opts.skipUpdates
 * @param {boolean} opts.reboot
 * @param {boolean} opts.dryRun
 * @param {boolean} [opts.skipMailRelay]
 * @param {boolean} [opts.mailRelayEnabled]
 * @param {string} [opts.hostId]
 * @param {(line: string) => void} opts.log
 * @param {(line: string) => void} opts.warn
 */
export async function maintainLinuxHost(opts) {
  const {
    target,
    spawnSync,
    env,
    skipUpdates,
    reboot,
    dryRun,
    skipMailRelay,
    mailRelayEnabled = true,
    hostId,
    log,
    warn,
  } = opts;

  if (dryRun) {
    log(`[dry-run] would SSH ${target.user}@${target.host} for apt dist-upgrade`);
    if (reboot) log(`[dry-run] would reboot if /var/run/reboot-required`);
    if (mailRelayEnabled && !skipMailRelay) {
      log(`[dry-run] would configure Postfix satellite on ${target.user}@${target.host}`);
    }
    return { ok: true, dry_run: true };
  }

  const { identities } = discoverLocalSshMaterial();

  if (!sshReachableWithPubkey(target, spawnSync, env, identities)) {
    return { ok: false, message: "SSH public-key auth failed" };
  }

  if (!skipUpdates) {
    log(`apt dist-upgrade on ${target.user}@${target.host} …`);
    const upgrade = sshExec(
      target,
      [
        "bash",
        "-lc",
        "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get dist-upgrade -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold",
      ],
      spawnSync,
      env,
      identities,
    );
    if (upgrade.status !== 0) {
      const err = `${upgrade.stderr ?? ""}${upgrade.stdout ?? ""}`.trim();
      return { ok: false, message: `apt dist-upgrade failed: ${err || "no output"}` };
    }
  }

  const rebootCheck = sshExec(
    target,
    ["test", "-f", "/var/run/reboot-required"],
    spawnSync,
    env,
    identities,
    30_000,
  );
  const rebootRequired = rebootCheck.status === 0;

  /** @type {Record<string, unknown> | undefined} */
  let mail_relay;
  if (mailRelayEnabled && !skipMailRelay) {
    log(`configuring Postfix satellite (mail relay) on ${target.user}@${target.host} …`);
    const plog = provisionLogFromConsole({ info: log, warn });
    const exec = createConfigureExec("ssh", {
      user: target.user,
      host: target.host,
      env,
      log,
      useGuestSshFallback: false,
    });
    mail_relay = await ensurePostfixSatellite({
      exec,
      log: plog,
      deployment: {
        system_id: hostId || target.host,
        hostname: hostId || target.host,
      },
    });
    if (!mail_relay.skipped && !mail_relay.ok) {
      return {
        ok: false,
        reboot_required: rebootRequired,
        mail_relay,
        message: mail_relay.message,
      };
    }
  }

  if (!rebootRequired) {
    return { ok: true, reboot_required: false, mail_relay };
  }
  if (!reboot) {
    return { ok: true, reboot_required: true, rebooted: false, mail_relay };
  }

  log(`reboot required — rebooting ${target.host} …`);
  sshExec(target, ["systemctl", "reboot"], spawnSync, env, identities, 15_000);
  await sleep(15_000);
  const deadline = Date.now() + 5 * 60 * 1000;
  let back = false;
  while (Date.now() < deadline) {
    if (sshReachableWithPubkey(target, spawnSync, env, identities)) {
      back = true;
      break;
    }
    await sleep(10_000);
  }
  if (!back) {
    warn(`host did not return via SSH within 300s after reboot`);
    return { ok: false, reboot_required: true, rebooted: false, message: "SSH timeout after reboot", mail_relay };
  }
  return { ok: true, reboot_required: true, rebooted: true, mail_relay };
}
