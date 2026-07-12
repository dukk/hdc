import {
  noRebootFromFlags,
  parseGuestResourceSizing,
} from "../infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import { ensureAdminUser } from "./admin-user-ensure.mjs";
import { ensureClamav } from "./clamav-ensure.mjs";
import { ensureClamavScanSchedule } from "./clamav-scan-schedule.mjs";
import { ensureCrowdsecAgent } from "./crowdsec-agent-ensure.mjs";
import { ensureHdcUser } from "./hdc-user-ensure.mjs";
import { ensurePostfixSatellite } from "./postfix-satellite-ensure.mjs";
import { resolveGuestSshUser } from "./guest-ssh-resolve.mjs";
import { ensureRootDisabled } from "./root-login-disable.mjs";
import { ensureUnattendedUpgrades } from "./unattended-upgrades-ensure.mjs";
import { ensureWazuhAgent } from "./wazuh-agent-ensure.mjs";
import { isNagiosGuestSystem } from "./guest-agents-config.mjs";
import {
  proxmoxGuestTypeFromMode,
  syncProxmoxGuestResourcesOnMaintain,
} from "./proxmox-guest-resources-maintain.mjs";
import { syncProxmoxGuestStartupOnMaintain } from "./proxmox-guest-startup-maintain-sync.mjs";
import { syncProxmoxGuestTagsOnMaintain } from "./proxmox-guest-tags-maintain-sync.mjs";
import { waitForQemuGuestSshAfterBoot } from "./qemu-guest-ssh-wait.mjs";
import { waitForSsh } from "./ssh-wait.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} [deployment]
 * @param {Record<string, string>} [flags]
 */
/**
 * @param {Record<string, unknown>} [deployment]
 * @returns {number | undefined}
 */
function memoryMbFromDeployment(deployment) {
  if (!deployment || !isObject(deployment)) return undefined;
  const guestType = proxmoxGuestTypeFromMode(deployment.mode);
  if (!guestType) return undefined;
  const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
  const block = guestType === "qemu" ? px.qemu : px.lxc;
  const sizing = parseGuestResourceSizing(block);
  return sizing?.memoryMb;
}

function baselineFlagsForDeployment(deployment, flags) {
  const systemId =
    deployment && typeof deployment.system_id === "string"
      ? deployment.system_id.trim()
      : "";
  if (!isNagiosGuestSystem(systemId)) {
    return flags ?? {};
  }
  return {
    ...(flags ?? {}),
    "skip-clamav": "1",
    "skip-clamav-scan": "1",
    "skip-crowdsec-agent": "1",
    "skip-wazuh-agent": "1",
  };
}

/**
 * SSH target for proxmox-qemu guests (configure.ssh or proxmox.qemu.ip).
 * @param {Record<string, unknown>} deployment
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ user: string; host: string } | null}
 */
export function resolveQemuSshTargetFromDeployment(deployment, env) {
  const mode = typeof deployment.mode === "string" ? deployment.mode.trim() : "";
  if (mode !== "proxmox-qemu") return null;

  const configure = isObject(deployment.configure) ? deployment.configure : {};
  const sshCfg = isObject(configure.ssh) ? configure.ssh : {};
  const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
  const q = isObject(px.qemu) ? px.qemu : {};

  const user = resolveGuestSshUser(sshCfg.user, env);
  let host = "";
  if (typeof sshCfg.host === "string" && sshCfg.host.trim()) {
    host = sshCfg.host.trim().split("/")[0];
  } else if (typeof q.ip === "string" && q.ip.trim()) {
    host = q.ip.trim().split("/")[0];
  }
  if (!host) return null;
  return { user, host };
}

/**
 * Guest maintain baseline: Proxmox CPU/RAM sync (optional), hdc + admin users, ClamAV,
 * staggered scan, unattended-upgrades, mail relay, CrowdSec/Wazuh agents, root disable.
 *
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {ReturnType<import("./package-vault-access.mjs").createPackageVaultAccess>} [opts.vaultAccess]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {Record<string, unknown>} [opts.deployment] when set with proxmoxPackageRoot, sync memory_mb/cores
 * @param {string} [opts.proxmoxPackageRoot]
 * @param {string} [opts.clumpId] service manifest id for startup priority fallback
 * @param {string} [opts.repoRoot]
 */
export async function ensureGuestLinuxBaseline(opts) {
  /** @type {Record<string, unknown> | { skipped: boolean; message?: string }} */
  let guest_resources = { skipped: true, message: "no deployment" };
  /** @type {Record<string, unknown> | { skipped: boolean; message?: string }} */
  let guest_startup = { skipped: true, message: "no deployment" };
  /** @type {Record<string, unknown> | { skipped: boolean; message?: string }} */
  let guest_tags = { skipped: true, message: "no deployment" };

  const deployment = opts.deployment;
  const proxmoxPackageRoot = opts.proxmoxPackageRoot;
  const mode =
    deployment && typeof deployment === "object" && !Array.isArray(deployment)
      ? /** @type {Record<string, unknown>} */ (deployment).mode
      : undefined;

  const systemId =
    deployment && typeof deployment === "object" && !Array.isArray(deployment)
      ? typeof /** @type {Record<string, unknown>} */ (deployment).system_id === "string"
        ? /** @type {Record<string, unknown>} */ (deployment).system_id.trim()
        : ""
      : "";

  const effectiveFlags = baselineFlagsForDeployment(
    deployment && isObject(deployment) ? deployment : undefined,
    opts.flags,
  );

  if (deployment && proxmoxPackageRoot && proxmoxGuestTypeFromMode(mode)) {
    const logLine = (line) => opts.log.info(line);
    guest_resources = await syncProxmoxGuestResourcesOnMaintain({
      deployment,
      proxmoxPackageRoot,
      flags: effectiveFlags,
      log: logLine,
    });
    if (guest_resources.ok === false) {
      const msg =
        typeof guest_resources.message === "string"
          ? guest_resources.message
          : "guest resource sync failed";
      if (opts.log.warn) {
        opts.log.warn(`guest resource sync: ${msg} (continuing with guest users / ClamAV)`);
      } else {
        opts.log.info(`guest resource sync: ${msg} (continuing with guest users / ClamAV)`);
      }
    } else {
      const resourcesChanged = guest_resources.changed === true;
      const qemuMode = mode === "proxmox-qemu";
      const skipRebootWait = noRebootFromFlags(effectiveFlags);
      if (resourcesChanged && qemuMode && !skipRebootWait && deployment) {
        const sshTarget = resolveQemuSshTargetFromDeployment(
          /** @type {Record<string, unknown>} */ (deployment),
          opts.env,
        );
        const gr = /** @type {Record<string, unknown>} */ (guest_resources);
        const apiBase = typeof gr.apiBase === "string" ? gr.apiBase : "";
        const authorization = typeof gr.authorization === "string" ? gr.authorization : "";
        const rejectUnauthorized = gr.rejectUnauthorized === false ? false : true;
        const node = typeof gr.node === "string" ? gr.node : "";
        const vmid = typeof gr.vmid === "number" ? gr.vmid : Number(gr.vmid);
        if (
          sshTarget &&
          apiBase &&
          authorization &&
          node &&
          Number.isFinite(vmid) &&
          vmid > 0 &&
          proxmoxPackageRoot
        ) {
          opts.log.info(
            `waiting for SSH on ${sshTarget.user}@${sshTarget.host} after guest resource change …`,
          );
          await waitForQemuGuestSshAfterBoot({
            user: sshTarget.user,
            host: sshTarget.host,
            apiBase,
            authorization,
            rejectUnauthorized,
            node,
            vmid,
            freshClone: false,
            proxmoxPackageRoot,
            flags: effectiveFlags,
            log: (line) => opts.log.info(line),
          });
        } else if (sshTarget) {
          opts.log.info(
            `waiting for SSH on ${sshTarget.user}@${sshTarget.host} after guest resource change …`,
          );
          await waitForSsh({ user: sshTarget.user, host: sshTarget.host });
        }
      }
    }

    guest_startup = await syncProxmoxGuestStartupOnMaintain({
      deployment,
      proxmoxPackageRoot,
      clumpId: opts.clumpId,
      flags: effectiveFlags,
      log: logLine,
    });
    if (guest_startup.ok === false) {
      const msg =
        typeof guest_startup.message === "string"
          ? guest_startup.message
          : "guest startup sync failed";
      if (opts.log.warn) {
        opts.log.warn(`guest startup sync: ${msg} (continuing with guest users / ClamAV)`);
      } else {
        opts.log.info(`guest startup sync: ${msg} (continuing with guest users / ClamAV)`);
      }
    }

    guest_tags = await syncProxmoxGuestTagsOnMaintain({
      deployment,
      proxmoxPackageRoot,
      clumpId: opts.clumpId,
      flags: effectiveFlags,
      log: logLine,
    });
    if (guest_tags.ok === false) {
      const msg =
        typeof guest_tags.message === "string" ? guest_tags.message : "guest tags sync failed";
      if (opts.log.warn) {
        opts.log.warn(`guest tags sync: ${msg} (continuing with guest users / ClamAV)`);
      } else {
        opts.log.info(`guest tags sync: ${msg} (continuing with guest users / ClamAV)`);
      }
    }
  }

  const memoryMb = memoryMbFromDeployment(
    deployment && isObject(deployment) ? deployment : undefined,
  );
  const baselineOpts = { ...opts, flags: effectiveFlags, memoryMb };

  const hdcUser = await ensureHdcUser(baselineOpts);
  const adminUser = await ensureAdminUser(baselineOpts);
  const clamav = await ensureClamav(baselineOpts);
  const clamavInstalled = clamav.ok && !clamav.skipped;
  const clamav_scan_schedule = await ensureClamavScanSchedule({
    exec: opts.exec,
    log: opts.log,
    flags: effectiveFlags,
    systemId,
    clamavInstalled,
  });
  const unattended_upgrades = await ensureUnattendedUpgrades({
    exec: opts.exec,
    log: opts.log,
    flags: effectiveFlags,
    systemId,
  });
  const mail_relay = await ensurePostfixSatellite({
    exec: opts.exec,
    log: opts.log,
    flags: effectiveFlags,
    deployment: deployment && isObject(deployment) ? deployment : undefined,
  });
  const crowdsec_agent = await ensureCrowdsecAgent({
    exec: opts.exec,
    log: opts.log,
    flags: effectiveFlags,
    vaultAccess: opts.vaultAccess,
    proxmoxPackageRoot,
    repoRoot: opts.repoRoot,
  });
  const wazuh_agent = await ensureWazuhAgent({
    exec: opts.exec,
    log: opts.log,
    flags: effectiveFlags,
    vaultAccess: opts.vaultAccess,
    proxmoxPackageRoot,
    repoRoot: opts.repoRoot,
  });
  const root_login_disabled = ensureRootDisabled({
    exec: opts.exec,
    log: opts.log,
    flags: effectiveFlags,
    env: opts.env,
    hdcUser,
    adminUser,
  });

  const guestResourcesOk = guest_resources.ok !== false || guest_resources.skipped === true;
  const guestStartupOk = guest_startup.ok !== false || guest_startup.skipped === true;
  const guestTagsOk = guest_tags.ok !== false || guest_tags.skipped === true;
  const usersOk =
    (hdcUser.skipped || hdcUser.ok) &&
    (adminUser.skipped || adminUser.ok) &&
    (root_login_disabled.skipped || root_login_disabled.ok);
  const mailOk = mail_relay.skipped || mail_relay.ok;
  const clamavOk = clamav.ok || clamav.skipped;
  const scanOk = clamav_scan_schedule.ok || clamav_scan_schedule.skipped;
  const uuOk = unattended_upgrades.ok || unattended_upgrades.skipped;
  const csOk = crowdsec_agent.ok || crowdsec_agent.skipped;
  const wzOk = wazuh_agent.ok || wazuh_agent.skipped;

  return {
    ok: guestResourcesOk && guestStartupOk && guestTagsOk && usersOk && clamavOk && mailOk && scanOk && uuOk && csOk && wzOk,
    guest_resources,
    guest_startup,
    guest_tags,
    hdc_user: hdcUser,
    admin_user: adminUser,
    clamav,
    clamav_scan_schedule,
    unattended_upgrades,
    mail_relay,
    crowdsec_agent,
    wazuh_agent,
    root_login_disabled,
  };
}
