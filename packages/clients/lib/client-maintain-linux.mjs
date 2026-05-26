import {
  discoverLocalSshMaterial,
  sshReachableWithPubkey,
  sshSpawn,
} from "../../../tools/hdc/lib/ssh-host-access.mjs";

/**
 * @param {{ user: string; host: string }} target
 * @param {typeof import("node:child_process").spawnSync} spawnSync
 * @param {NodeJS.ProcessEnv} env
 * @param {typeof import("../../../tools/hdc/lib/ssh-host-access.mjs").discoverLocalSshMaterial} identities
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
 * @param {(line: string) => void} opts.log
 * @param {(line: string) => void} opts.warn
 */
export async function maintainLinuxHost(opts) {
  const { target, spawnSync, env, skipUpdates, reboot, dryRun, log, warn } = opts;
  const { identities } = discoverLocalSshMaterial();

  if (dryRun) {
    log(`[dry-run] would SSH ${target.user}@${target.host} for apt dist-upgrade`);
    if (reboot) log(`[dry-run] would reboot if /var/run/reboot-required`);
    return { ok: true, dry_run: true };
  }

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
  if (!rebootRequired) {
    return { ok: true, reboot_required: false };
  }
  if (!reboot) {
    return { ok: true, reboot_required: true, rebooted: false };
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
    return { ok: false, reboot_required: true, rebooted: false, message: "SSH timeout after reboot" };
  }
  return { ok: true, reboot_required: true, rebooted: true };
}
