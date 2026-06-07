import { noRebootFromFlags } from "../infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import { ensureAdminUser } from "./admin-user-ensure.mjs";
import { ensureClamav } from "./clamav-ensure.mjs";
import {
  proxmoxGuestTypeFromMode,
  syncProxmoxGuestResourcesOnMaintain,
} from "./proxmox-guest-resources-maintain.mjs";
import { waitForSsh } from "./ssh-wait.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * SSH target for proxmox-qemu guests (configure.ssh or proxmox.qemu.ip).
 * @param {Record<string, unknown>} deployment
 * @returns {{ user: string; host: string } | null}
 */
export function resolveQemuSshTargetFromDeployment(deployment) {
  const mode = typeof deployment.mode === "string" ? deployment.mode.trim() : "";
  if (mode !== "proxmox-qemu") return null;

  const configure = isObject(deployment.configure) ? deployment.configure : {};
  const sshCfg = isObject(configure.ssh) ? configure.ssh : {};
  const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
  const q = isObject(px.qemu) ? px.qemu : {};

  const user =
    typeof sshCfg.user === "string" && sshCfg.user.trim() ? sshCfg.user.trim() : "root";
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
 * Guest maintain baseline: Proxmox CPU/RAM sync (optional), local admin user + ClamAV.
 *
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {ReturnType<import("./package-vault-access.mjs").createPackageVaultAccess>} [opts.vaultAccess]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {Record<string, unknown>} [opts.deployment] when set with proxmoxPackageRoot, sync memory_mb/cores
 * @param {string} [opts.proxmoxPackageRoot]
 */
export async function ensureGuestLinuxBaseline(opts) {
  /** @type {Record<string, unknown> | { skipped: boolean; message?: string }} */
  let guest_resources = { skipped: true, message: "no deployment" };

  const deployment = opts.deployment;
  const proxmoxPackageRoot = opts.proxmoxPackageRoot;
  const mode =
    deployment && typeof deployment === "object" && !Array.isArray(deployment)
      ? /** @type {Record<string, unknown>} */ (deployment).mode
      : undefined;

  if (deployment && proxmoxPackageRoot && proxmoxGuestTypeFromMode(mode)) {
    const logLine = (line) => opts.log.info(line);
    guest_resources = await syncProxmoxGuestResourcesOnMaintain({
      deployment,
      proxmoxPackageRoot,
      flags: opts.flags,
      log: logLine,
    });
    if (guest_resources.ok === false) {
      const msg =
        typeof guest_resources.message === "string"
          ? guest_resources.message
          : "guest resource sync failed";
      if (opts.log.warn) {
        opts.log.warn(`guest resource sync: ${msg} (continuing with admin user / ClamAV)`);
      } else {
        opts.log.info(`guest resource sync: ${msg} (continuing with admin user / ClamAV)`);
      }
    } else {
      const resourcesChanged = guest_resources.changed === true;
      const qemuMode = mode === "proxmox-qemu";
      const skipRebootWait = noRebootFromFlags(opts.flags);
      if (resourcesChanged && qemuMode && !skipRebootWait && deployment) {
        const sshTarget = resolveQemuSshTargetFromDeployment(
          /** @type {Record<string, unknown>} */ (deployment),
        );
        if (sshTarget) {
          opts.log.info(
            `waiting for SSH on ${sshTarget.user}@${sshTarget.host} after guest resource change …`,
          );
          await waitForSsh({ user: sshTarget.user, host: sshTarget.host });
        }
      }
    }
  }

  const adminUser = await ensureAdminUser(opts);
  const clamav = await ensureClamav(opts);
  const guestResourcesOk = guest_resources.ok !== false || guest_resources.skipped === true;
  return {
    ok: guestResourcesOk && adminUser.ok && clamav.ok,
    guest_resources,
    admin_user: adminUser,
    clamav,
  };
}
