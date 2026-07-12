import { loadClumpConfigFromClumpRoot } from "../../apps/hdc-cli/lib/clump-config.mjs";
import { authorizeProxmoxForHost } from "../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import {
  fetchClusterVmResources,
  locateVmidInCluster,
} from "../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { locateGuestByNameInCluster } from "../infrastructure/proxmox/lib/proxmox-backup-maintain.mjs";
import {
  applyGuestBootOptions,
  parseGuestBootOptions,
} from "../infrastructure/proxmox/lib/proxmox-guest-startup.mjs";
import { flagGet } from "./parse-argv-flags.mjs";
import { proxmoxGuestTypeFromMode } from "./proxmox-guest-resources-maintain.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

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
 * Sync onboot + startup order from clump config onto a live Proxmox guest.
 *
 * @param {object} opts
 * @param {Record<string, unknown>} opts.deployment merged deployment (mode + proxmox)
 * @param {string} opts.proxmoxPackageRoot clumps/infrastructure/proxmox
 * @param {string} [opts.clumpId] service package manifest id for priority fallback
 * @param {Record<string, string>} [opts.flags] --skip-startup, --dry-run
 * @param {(line: string) => void} [opts.log]
 */
export async function syncProxmoxGuestStartupOnMaintain(opts) {
  const { deployment, proxmoxPackageRoot, clumpId, flags = {} } = opts;
  const log = opts.log ?? (() => {});

  if (flagGet(flags, "skip-startup", "skip_startup") !== undefined) {
    return { ok: true, skipped: true, message: "--skip-startup" };
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
  if (!isObject(block)) {
    return { ok: true, skipped: true, message: "no proxmox guest block" };
  }

  let proxmoxCfg = null;
  try {
    proxmoxCfg = loadClumpConfigFromClumpRoot(proxmoxPackageRoot);
  } catch {
    proxmoxCfg = null;
  }

  const boot = parseGuestBootOptions(block, proxmoxCfg, clumpId);
  if (!boot?.startup) {
    return { ok: true, skipped: true, message: "no startup order configured" };
  }

  const vmidRaw = block.vmid;
  const vmid = typeof vmidRaw === "number" ? vmidRaw : Number(vmidRaw);
  const lookupName =
    (deployment && typeof deployment.hostname === "string" && deployment.hostname.trim()) ||
    (typeof block.hostname === "string" && block.hostname.trim()) ||
    (deployment && typeof deployment.system_id === "string" && deployment.system_id.trim()) ||
    "";

  if (!hostId) {
    return { ok: false, message: "missing host_id in proxmox config" };
  }

  const dryRun = flagGet(flags, "dry-run", "dry_run") !== undefined;
  if (dryRun) {
    log(`[dry-run] would set ${guestType} startup on ${hostId}`);
    return { ok: true, dry_run: true, guest_type: guestType, host_id: hostId, boot };
  }

  const auth = await authorizeProxmoxForHost({ clumpRoot: proxmoxPackageRoot, hostId });
  const resources = await fetchClusterVmResources(
    auth.host.apiBase,
    auth.authorization,
    auth.rejectUnauthorized,
  );

  let resolvedVmid = Number.isFinite(vmid) && vmid > 0 ? vmid : null;
  let node = auth.host.pveNode;
  if (resolvedVmid !== null) {
    const located = locateVmidInCluster(resources, resolvedVmid);
    if (!located) {
      return { ok: false, message: `vmid ${resolvedVmid} not found in cluster` };
    }
    node = located.node;
  } else if (lookupName) {
    const located = locateGuestByNameInCluster(resources, lookupName);
    if (!located) {
      return { ok: false, message: `guest ${lookupName} not found in cluster` };
    }
    resolvedVmid = located.vmid;
    node = located.node;
  } else {
    return { ok: false, message: "missing vmid or hostname for guest lookup" };
  }

  const applied = await applyGuestBootOptions({
    guestType,
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node,
    vmid: resolvedVmid,
    boot,
    log,
  });

  return {
    ok: applied.ok,
    guest_type: guestType,
    vmid: resolvedVmid,
    host_id: hostId,
    node,
    changed: applied.changed,
    applied: applied.applied,
  };
}
