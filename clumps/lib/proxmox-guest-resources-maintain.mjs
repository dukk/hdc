import { authorizeProxmoxForHost } from "../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import {
  applyLxcGuestResources,
  applyQemuGuestResources,
  noRebootFromFlags,
  parseGuestResourceSizing,
  rebootRequestedFromFlags,
} from "../infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import {
  fetchClusterVmResources,
  locateVmidInCluster,
} from "../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { proxmoxGuestTypeFromMode } from "../infrastructure/proxmox/lib/proxmox-guest-tags.mjs";
import { flagGet } from "./parse-argv-flags.mjs";

export { proxmoxGuestTypeFromMode };

/**
 * @param {unknown} deployment
 */
function deploymentProxmoxBlock(deployment) {
  if (!deployment || typeof deployment !== "object" || Array.isArray(deployment)) return null;
  const px = /** @type {Record<string, unknown>} */ (deployment).proxmox;
  return px && typeof px === "object" && !Array.isArray(px)
    ? /** @type {Record<string, unknown>} */ (px)
    : null;
}

/**
 * Sync memory_mb / cores from clump config onto a live Proxmox guest (no destroy).
 *
 * @param {object} opts
 * @param {Record<string, unknown>} opts.deployment merged deployment (mode + proxmox)
 * @param {string} opts.proxmoxPackageRoot clumps/infrastructure/proxmox
 * @param {Record<string, string>} [opts.flags] --skip-resources, --dry-run, --reboot, --no-reboot
 * @param {(line: string) => void} [opts.log]
 */
export async function syncProxmoxGuestResourcesOnMaintain(opts) {
  const { deployment, proxmoxPackageRoot, flags = {} } = opts;
  const log = opts.log ?? (() => {});

  if (flagGet(flags, "skip-resources", "skip_resources") !== undefined) {
    return { ok: true, skipped: true, message: "--skip-resources" };
  }

  const mode =
    deployment && typeof deployment === "object" && !Array.isArray(deployment)
      ? /** @type {Record<string, unknown>} */ (deployment).mode
      : undefined;
  const guestType = proxmoxGuestTypeFromMode(mode);
  if (!guestType) {
    return { ok: true, skipped: true, message: "not a proxmox guest mode" };
  }

  const px = deploymentProxmoxBlock(deployment);
  if (!px) {
    return { ok: false, message: "missing proxmox config on deployment" };
  }

  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  const block = guestType === "lxc" && px.lxc && typeof px.lxc === "object" ? px.lxc : px.qemu;
  const sizing = parseGuestResourceSizing(block);
  if (!sizing) {
    return { ok: true, skipped: true, message: "no memory_mb/cores in proxmox config" };
  }

  const vmidRaw =
    block && typeof block === "object" && !Array.isArray(block)
      ? /** @type {Record<string, unknown>} */ (block).vmid
      : undefined;
  const vmid = typeof vmidRaw === "number" ? vmidRaw : Number(vmidRaw);
  if (!hostId || !Number.isFinite(vmid) || vmid <= 0) {
    return { ok: false, message: "missing host_id or vmid in proxmox config" };
  }

  const dryRun = flagGet(flags, "dry-run", "dry_run") !== undefined;
  if (dryRun) {
    log(
      `[dry-run] would set ${guestType} ${vmid} on ${hostId}: memory=${sizing.memoryMb} cores=${sizing.cores}`,
    );
    return {
      ok: true,
      dry_run: true,
      guest_type: guestType,
      vmid,
      host_id: hostId,
      applied: { memory: sizing.memoryMb, cores: sizing.cores },
    };
  }

  const auth = await authorizeProxmoxForHost({ clumpRoot: proxmoxPackageRoot, hostId });
  const resources = await fetchClusterVmResources(
    auth.host.apiBase,
    auth.authorization,
    auth.rejectUnauthorized,
  );
  const located = locateVmidInCluster(resources, vmid);
  const node = located?.node ?? auth.host.pveNode;

  const reboot = rebootRequestedFromFlags(flags) && !noRebootFromFlags(flags);
  const rebootOnChange = !noRebootFromFlags(flags);

  const applyOpts = {
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node,
    vmid,
    memoryMb: sizing.memoryMb,
    cores: sizing.cores,
    reboot,
    rebootOnChange,
    log,
  };

  const applied =
    guestType === "lxc"
      ? await applyLxcGuestResources(applyOpts)
      : await applyQemuGuestResources(applyOpts);

  return {
    ok: applied.ok,
    guest_type: guestType,
    vmid,
    host_id: hostId,
    node,
    changed: applied.changed,
    previous: applied.previous,
    applied: applied.applied,
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
  };
}
