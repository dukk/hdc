import { rebootQemuGuest } from "../infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import { qemuFirstBootWaitOptsFromConfig } from "../infrastructure/proxmox/lib/proxmox-provision-config.mjs";
import { loadPackageConfigFromPackageRoot } from "./package-run-config.mjs";
import { flagGet } from "./parse-argv-flags.mjs";
import { waitForSsh } from "./ssh-wait.mjs";

/** @typedef {ReturnType<typeof qemuFirstBootWaitOptsFromConfig>} QemuFirstBootWaitOpts */

const DEFAULT_FIRST_BOOT = {
  settleMs: 45_000,
  sshProbeMs: 90_000,
  sshTimeoutMs: 300_000,
  rebootOnProbeFail: true,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} opts
 * @param {unknown} [opts.proxmoxCfg]
 * @param {string} [opts.proxmoxPackageRoot]
 */
function resolveProxmoxCfg(opts) {
  if (opts.proxmoxCfg) return opts.proxmoxCfg;
  if (typeof opts.proxmoxPackageRoot === "string" && opts.proxmoxPackageRoot.trim()) {
    try {
      return loadPackageConfigFromPackageRoot(opts.proxmoxPackageRoot.trim()).data;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * @param {object} opts
 * @param {unknown} [opts.proxmoxCfg]
 * @param {string} [opts.proxmoxPackageRoot]
 * @param {boolean} [opts.freshClone]
 * @param {Record<string, string>} [opts.flags]
 * @returns {QemuFirstBootWaitOpts & { alwaysReboot: boolean }}
 */
export function resolveQemuFirstBootWaitTiming(opts) {
  const proxmoxCfg = resolveProxmoxCfg(opts);
  const cfgOpts = proxmoxCfg
    ? qemuFirstBootWaitOptsFromConfig(proxmoxCfg)
    : { ...DEFAULT_FIRST_BOOT };
  const flags = opts.flags ?? {};
  const freshClone = opts.freshClone !== false;

  let alwaysReboot =
    flagGet(flags, "first-boot-reboot", "first_boot_reboot") !== undefined;
  let rebootOnProbeFail = cfgOpts.rebootOnProbeFail;
  if (flagGet(flags, "skip-first-boot-reboot", "skip_first_boot_reboot") !== undefined) {
    rebootOnProbeFail = false;
    alwaysReboot = false;
  }

  return {
    settleMs: freshClone ? cfgOpts.settleMs : 0,
    sshProbeMs: cfgOpts.sshProbeMs,
    sshTimeoutMs: cfgOpts.sshTimeoutMs,
    rebootOnProbeFail,
    alwaysReboot,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.user
 * @param {string} opts.host
 * @param {number} opts.timeoutMs
 * @param {(line: string) => void} [opts.log]
 * @returns {Promise<string>}
 */
async function waitForSshWithRootFallback(opts) {
  const { user, host, timeoutMs, log } = opts;
  try {
    await waitForSsh({ user, host, timeoutMs });
    return user;
  } catch (e) {
    if (user !== "root") {
      log?.(`${user} not ready — trying root@${host} …`);
      await waitForSsh({ user: "root", host, timeoutMs });
      return "root";
    }
    throw e;
  }
}

/**
 * Wait for SSH on a QEMU guest after start or reboot, with serial-console first-boot workaround.
 *
 * @param {object} opts
 * @param {string} opts.user
 * @param {string} opts.host
 * @param {string} opts.apiBase
 * @param {string} opts.node
 * @param {number} opts.vmid
 * @param {string} opts.authorization
 * @param {boolean} opts.rejectUnauthorized
 * @param {boolean} [opts.freshClone]
 * @param {unknown} [opts.proxmoxCfg]
 * @param {string} [opts.proxmoxPackageRoot]
 * @param {Record<string, string>} [opts.flags]
 * @param {(line: string) => void} [opts.log]
 * @returns {Promise<{ user: string }>}
 */
export async function waitForQemuGuestSshAfterBoot(opts) {
  const {
    user,
    host,
    apiBase,
    node,
    vmid,
    authorization,
    rejectUnauthorized,
    log,
  } = opts;

  const timing = resolveQemuFirstBootWaitTiming(opts);

  if (timing.settleMs > 0) {
    log?.(
      `waiting ${Math.round(timing.settleMs / 1000)}s for cloud-init on first boot before SSH probe …`,
    );
    await sleep(timing.settleMs);
  }

  const rebootOpts = {
    apiBase,
    node,
    vmid,
    authorization,
    rejectUnauthorized,
    log,
  };

  if (timing.alwaysReboot) {
    log?.(
      `rebooting QEMU ${vmid} before SSH wait (--first-boot-reboot; serial-console first-boot workaround) …`,
    );
    await rebootQemuGuest(rebootOpts);
    log?.(`waiting for SSH on ${user}@${host} after reboot …`);
    const resolvedUser = await waitForSshWithRootFallback({
      user,
      host,
      timeoutMs: timing.sshTimeoutMs,
      log,
    });
    return { user: resolvedUser };
  }

  log?.(`probing SSH on ${user}@${host} (up to ${Math.round(timing.sshProbeMs / 1000)}s) …`);
  try {
    const resolvedUser = await waitForSshWithRootFallback({
      user,
      host,
      timeoutMs: timing.sshProbeMs,
      log,
    });
    return { user: resolvedUser };
  } catch (probeErr) {
    if (!timing.rebootOnProbeFail) {
      throw probeErr;
    }
  }

  log?.(
    `SSH not ready — rebooting QEMU ${vmid} on ${node} (serial-console first-boot workaround) …`,
  );
  await rebootQemuGuest(rebootOpts);
  log?.(`waiting for SSH on ${user}@${host} after reboot …`);
  const resolvedUser = await waitForSshWithRootFallback({
    user,
    host,
    timeoutMs: timing.sshTimeoutMs,
    log,
  });
  return { user: resolvedUser };
}
