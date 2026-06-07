import { resolveGuestSshUser } from "./guest-ssh-resolve.mjs";
import { authorizeProxmoxForHost } from "../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import {
  fetchClusterVmResources,
  listQemuGuests,
} from "../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { createConfigureExec } from "../services/postfix-relay/lib/postfix-relay-configure.mjs";
import { resolvePveSshForHost } from "../services/ollama/lib/ollama-install.mjs";
import { sshRemote } from "./pve-pct-remote.mjs";
import { flagGet } from "./parse-argv-flags.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const GIB = 1024 ** 3;

/**
 * @param {Record<string, unknown>} deployment
 * @returns {number | null}
 */
export function resolveRootfsGbFromDeployment(deployment) {
  const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
  const q = isObject(px.qemu) ? px.qemu : {};
  const raw = q.rootfs_gb;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {Record<string, unknown>} deployment
 * @returns {string}
 */
export function resolveDeploymentHostname(deployment) {
  const hostname =
    typeof deployment.hostname === "string" && deployment.hostname.trim()
      ? deployment.hostname.trim()
      : "";
  if (hostname) return hostname;
  const systemId =
    typeof deployment.system_id === "string" && deployment.system_id.trim()
      ? deployment.system_id.trim()
      : "";
  return systemId.replace(/^vm-/, "");
}

/**
 * @param {Record<string, unknown>[]} resources
 * @param {string} name
 * @returns {{ vmid: number; node: string; name: string; maxdisk: number } | null}
 */
export function locateQemuGuestByName(resources, name) {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  for (const row of resources) {
    if (!isObject(row)) continue;
    if (typeof row.type === "string" && row.type !== "qemu") continue;
    const guestName = typeof row.name === "string" ? row.name.trim().toLowerCase() : "";
    if (guestName !== want) continue;
    const vmid = typeof row.vmid === "number" ? row.vmid : Number(row.vmid);
    const node = typeof row.node === "string" ? row.node.trim() : "";
    const maxdisk = typeof row.maxdisk === "number" ? row.maxdisk : Number(row.maxdisk);
    if (!Number.isFinite(vmid) || vmid <= 0 || !node) continue;
    return {
      vmid,
      node,
      name: typeof row.name === "string" ? row.name.trim() : `vmid-${vmid}`,
      maxdisk: Number.isFinite(maxdisk) ? maxdisk : 0,
    };
  }
  for (const g of listQemuGuests(resources)) {
    if (g.name.trim().toLowerCase() === want) {
      return { ...g, maxdisk: 0 };
    }
  }
  return null;
}

/** @returns {string} */
export function growRootFilesystemScript() {
  return [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "if ! command -v growpart >/dev/null 2>&1; then",
    "  apt-get update -qq",
    "  apt-get install -y -qq cloud-guest-utils",
    "fi",
    "apt-get clean 2>/dev/null || true",
    "journalctl --vacuum-size=20M 2>/dev/null || true",
    "rm -rf /var/cache/apt/archives/partial/* 2>/dev/null || true",
    'ROOT_PART=$(findmnt -n -o SOURCE / | sed "s/[0-9]*$//")',
    'ROOT_NUM=$(findmnt -n -o SOURCE / | grep -oE "[0-9]+$")',
    'if [ -n "$ROOT_PART" ] && [ -n "$ROOT_NUM" ]; then',
    "  export TMPDIR=/var/tmp",
    '  if ! growpart "$ROOT_PART" "$ROOT_NUM" 2>/tmp/hdc-growpart.err; then',
    "    grep -q 'NOCHANGE:' /tmp/hdc-growpart.err || { cat /tmp/hdc-growpart.err >&2; exit 1; }",
    "  fi",
    '  resize2fs "$(findmnt -n -o SOURCE /)" 2>/dev/null || true',
    "fi",
    'df -h / | tail -1',
  ].join("\n");
}

/**
 * @param {object} opts
 * @param {string} opts.sshUser
 * @param {string} opts.sshHost
 * @param {number} opts.vmid
 * @param {number} opts.rootfsGb
 * @param {(line: string) => void} [opts.log]
 */
export function resizeQemuScsi0OnHypervisor(opts) {
  const { sshUser, sshHost, vmid, rootfsGb, log = () => {} } = opts;
  if (!Number.isFinite(rootfsGb) || rootfsGb <= 0) {
    throw new Error("rootfsGb must be a positive number");
  }
  log(`resizing scsi0 to ${rootfsGb}G on vmid ${vmid} (${sshUser}@${sshHost}) …`);
  const resize = sshRemote(sshUser, sshHost, `qm resize ${vmid} scsi0 ${rootfsGb}G`, {
    capture: true,
  });
  if (resize.status !== 0) {
    const detail = `${resize.stderr}${resize.stdout}`.trim() || `exit ${resize.status}`;
    throw new Error(`qm resize failed: ${detail}`);
  }
  return { ok: true, vmid, rootfs_gb: rootfsGb };
}

/**
 * @param {object} opts
 * @param {{ run: (inner: string, opts?: { capture?: boolean }) => { status: number; stdout: string; stderr: string }}; label: string }} opts.exec
 * @param {{ info: (msg: string) => void }} opts.log
 */
export function growRootFilesystemInGuest(opts) {
  const { exec, log } = opts;
  const script = growRootFilesystemScript();
  log.info(`${exec.label}: growing root filesystem`);
  const r = exec.run(script, { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    throw new Error(`root filesystem grow failed (${exec.label}): ${detail}`);
  }
  const dfLine = r.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  return { ok: true, message: "root filesystem grown", df: dfLine };
}

/**
 * @param {Record<string, unknown>} deployment
 * @returns {{ user: string; host: string } | null}
 */
export function resolveGuestSshFromDeployment(deployment) {
  const configure = isObject(deployment.configure) ? deployment.configure : {};
  const sshCfg = isObject(configure.ssh) ? configure.ssh : {};
  const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
  const q = isObject(px.qemu) ? px.qemu : {};
  const user =
    resolveGuestSshUser(sshCfg.user);
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
 * @param {object} opts
 * @param {string} opts.proxmoxPackageRoot
 * @param {Record<string, unknown>} opts.deployment
 * @param {Record<string, string>} [opts.flags]
 * @param {(line: string) => void} [opts.log]
 */
export async function syncQemuRootfsOnMaintain(opts) {
  const { proxmoxPackageRoot, deployment, flags = {}, log = () => {} } = opts;

  if (flagGet(flags, "skip-disk-resize", "skip_disk_resize") !== undefined) {
    return { ok: true, skipped: true, message: "--skip-disk-resize" };
  }

  const mode = typeof deployment.mode === "string" ? deployment.mode.trim() : "";
  if (mode !== "proxmox-qemu") {
    return { ok: true, skipped: true, message: "not proxmox-qemu" };
  }

  const rootfsGb = resolveRootfsGbFromDeployment(deployment);
  if (!rootfsGb) {
    return { ok: true, skipped: true, message: "no rootfs_gb in proxmox.qemu config" };
  }

  const px = isObject(deployment.proxmox) ? deployment.proxmox : {};
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) {
    return { ok: false, message: "missing proxmox.host_id" };
  }

  const hostname = resolveDeploymentHostname(deployment);
  if (!hostname) {
    return { ok: false, message: "missing deployment hostname" };
  }

  const guestSsh = resolveGuestSshFromDeployment(deployment);
  if (!guestSsh) {
    return { ok: false, message: "missing guest SSH target (configure.ssh.host or proxmox.qemu.ip)" };
  }

  const dryRun = flagGet(flags, "dry-run", "dry_run") !== undefined;
  const targetBytes = rootfsGb * GIB;

  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxPackageRoot, hostId });
  const resources = await fetchClusterVmResources(
    auth.host.apiBase,
    auth.authorization,
    auth.rejectUnauthorized,
  );
  const located = locateQemuGuestByName(resources, hostname);
  if (!located) {
    return { ok: false, message: `QEMU guest ${JSON.stringify(hostname)} not found in cluster` };
  }

  const beforeGb = Math.round((located.maxdisk / GIB) * 10) / 10;
  if (located.maxdisk >= targetBytes * 0.98) {
    return {
      ok: true,
      skipped: true,
      message: `disk already ${beforeGb}G (target ${rootfsGb}G)`,
      vmid: located.vmid,
      before_gb: beforeGb,
      after_gb: beforeGb,
      changed: false,
    };
  }

  if (dryRun) {
    log(`[dry-run] would resize vmid ${located.vmid} scsi0 to ${rootfsGb}G and grow guest /`);
    return {
      ok: true,
      dry_run: true,
      vmid: located.vmid,
      before_gb: beforeGb,
      after_gb: rootfsGb,
      changed: true,
    };
  }

  const pveSsh = resolvePveSshForHost(proxmoxPackageRoot, hostId);
  resizeQemuScsi0OnHypervisor({
    sshUser: pveSsh.user,
    sshHost: pveSsh.host,
    vmid: located.vmid,
    rootfsGb,
    log,
  });

  const exec = createConfigureExec("ssh", guestSsh);
  const provisionLog = { info: (msg) => log(msg) };
  const grow = growRootFilesystemInGuest({ exec, log: provisionLog });

  return {
    ok: true,
    changed: true,
    vmid: located.vmid,
    host_id: hostId,
    node: located.node,
    before_gb: beforeGb,
    after_gb: rootfsGb,
    hypervisor_resize: { ok: true, rootfs_gb: rootfsGb },
    guest_grow: grow,
  };
}
