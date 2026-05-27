import { stderr as errout } from "node:process";

import { enableQemuAgentInConfig } from "../../../infrastructure/proxmox/lib/proxmox-qemu-guest-agent-install.mjs";
import { pveFormBody, pveJsonRequest, waitForPveTask } from "../../../infrastructure/proxmox/lib/pve-http.mjs";
import { extractPveUpid } from "../../../infrastructure/proxmox/lib/proxmox-qemu-post-clone.mjs";
import { startQemuGuest, stopQemuGuest } from "../../bind/lib/proxmox-qemu-redeploy.mjs";

/**
 * @param {string} volid
 */
export function ideMediaFromVolid(volid) {
  return `${volid},media=cdrom`;
}

/**
 * @param {object} opts
 * @param {string} opts.apiBase
 * @param {string} opts.node
 * @param {string} opts.authorization
 * @param {boolean} opts.rejectUnauthorized
 * @param {number} opts.vmid
 * @param {string} opts.name
 * @param {number} opts.memoryMb
 * @param {number} opts.cores
 * @param {string} opts.machine
 * @param {string} opts.storage Disk storage (local-lvm)
 * @param {number} opts.diskGb
 * @param {string} opts.bridge
 * @param {string} opts.windowsIsoVolid
 * @param {string} opts.virtioIsoVolid
 * @param {string} opts.autounattendIsoVolid
 * @param {string} [opts.cpu]
 * @param {string} [opts.tpmVersion]
 * @param {(line: string) => void} [opts.log]
 */
export async function createWindows11QemuVm(opts) {
  const log = opts.log ?? ((line) => errout.write(`${line}\n`));
  const {
    apiBase,
    node,
    authorization,
    rejectUnauthorized,
    vmid,
    name,
    memoryMb,
    cores,
    machine,
    storage,
    diskGb,
    bridge,
    windowsIsoVolid,
    virtioIsoVolid,
    autounattendIsoVolid,
    cpu = "host",
    tpmVersion = "v2.0",
  } = opts;

  const createPath = `/nodes/${encodeURIComponent(node)}/qemu`;
  log(`Creating QEMU VM ${vmid} (${name}) on ${node} …`);
  await pveJsonRequest(
    "POST",
    apiBase,
    createPath,
    authorization,
    rejectUnauthorized,
    pveFormBody({
      vmid,
      name,
      memory: memoryMb,
      cores,
      ostype: "win11",
      machine,
      bios: "ovmf",
      scsihw: "virtio-scsi-pci",
      net0: `virtio,bridge=${bridge}`,
      cpu,
    }),
  );

  const configPath = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/config`;
  /** @type {Record<string, string | number>} */
  const fields = {
    scsi0: `${storage}:${diskGb},format=qcow2`,
    ide0: ideMediaFromVolid(windowsIsoVolid),
    ide1: ideMediaFromVolid(virtioIsoVolid),
    ide2: ideMediaFromVolid(autounattendIsoVolid),
    boot: "order=ide0;scsi0",
    agent: 1,
    efidisk0: `${storage}:1,efitype=4m,pre-enrolled-keys=1,size=4M`,
    tpmstate0: `${storage}:1,size=4M,version=${tpmVersion}`,
  };

  log(`Configuring VM ${vmid} (disks, EFI, TPM, ISOs) …`);
  await pveJsonRequest(
    "PUT",
    apiBase,
    configPath,
    authorization,
    rejectUnauthorized,
    pveFormBody(fields),
  );

  await enableQemuAgentInConfig({
    apiBase,
    node,
    vmid,
    authorization,
    rejectUnauthorized,
    log,
  });

  return { vmid, node, name };
}

/**
 * Best-effort wait for Windows setup: VM runs then stops, or timeout.
 * @param {object} opts
 * @param {string} opts.apiBase
 * @param {string} opts.node
 * @param {number} opts.vmid
 * @param {string} opts.authorization
 * @param {boolean} opts.rejectUnauthorized
 * @param {number} opts.timeoutMs
 * @param {(line: string) => void} [opts.log]
 */
export async function waitForWindowsInstallWindow(opts) {
  const { apiBase, node, vmid, authorization, rejectUnauthorized, timeoutMs } = opts;
  const log = opts.log ?? ((line) => errout.write(`${line}\n`));
  const statusPath = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/status/current`;
  const deadline = Date.now() + timeoutMs;
  let sawRunning = false;

  log(`Waiting for Windows install (timeout ${Math.round(timeoutMs / 60_000)} min) …`);

  while (Date.now() < deadline) {
    const body = await pveJsonRequest(
      "GET",
      apiBase,
      statusPath,
      authorization,
      rejectUnauthorized,
      undefined,
    );
    const data = /** @type {Record<string, unknown>} */ (body?.data ?? body);
    const status = typeof data?.status === "string" ? data.status : "";
    if (status === "running") {
      sawRunning = true;
    } else if (sawRunning && (status === "stopped" || status === "")) {
      log(`VM ${vmid} stopped after install activity — continuing.`);
      return { ok: true, completed: true };
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }

  log(`Install wait timed out after ${Math.round(timeoutMs / 60_000)} minutes.`);
  return { ok: true, completed: false, timedOut: true };
}

export { startQemuGuest, stopQemuGuest };
