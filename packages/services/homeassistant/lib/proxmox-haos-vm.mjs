import { stderr as errout } from "node:process";

import { pveData, pveFormBody, pveJsonRequest, waitForPveTask } from "../../../infrastructure/proxmox/lib/pve-http.mjs";
import { extractPveUpid } from "../../../infrastructure/proxmox/lib/proxmox-qemu-post-clone.mjs";
import { sshRemote } from "../../../lib/pve-pct-remote.mjs";
import { haosOvaDownloadUrl, haosOvaFilename, haosQcow2Filename } from "./haos-image.mjs";

/**
 * @param {string} user
 * @param {string} host
 * @param {string} remoteCommand
 */
function sshChecked(user, host, remoteCommand) {
  const r = sshRemote(user, host, remoteCommand, { capture: true });
  if (r.status !== 0) {
    throw new Error(
      `SSH ${user}@${host} failed (${r.status}): ${r.stderr.trim() || r.stdout.trim() || remoteCommand}`,
    );
  }
  return r.stdout;
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
 * @param {string} opts.bridge
 * @param {string} opts.storage Disk storage (local-lvm)
 * @param {string} opts.imageStorage Download/import dir storage id (local)
 * @param {string} opts.release HAOS version
 * @param {number} opts.rootfsGb Target disk size after import
 * @param {string} opts.sshUser Proxmox host SSH user
 * @param {string} opts.sshHost Proxmox host SSH address
 * @param {(line: string) => void} [opts.log]
 */
export async function provisionHaosQemuVm(opts) {
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
    bridge,
    storage,
    imageStorage,
    release,
    rootfsGb,
    sshUser,
    sshHost,
  } = opts;

  const xzName = haosOvaFilename(release);
  const qcow2Name = haosQcow2Filename(release);
  const downloadUrl = haosOvaDownloadUrl(release);
  const imageDir = `/var/lib/vz/template/iso`;
  const xzPath = `${imageDir}/${xzName}`;
  const qcow2Path = `${imageDir}/${qcow2Name}`;

  const createPath = `/nodes/${encodeURIComponent(node)}/qemu`;
  log(`Creating QEMU VM ${vmid} (${name}) on ${node} for Home Assistant OS …`);
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
      ostype: "l26",
      machine: "q35",
      bios: "ovmf",
      scsihw: "virtio-scsi-pci",
      net0: `virtio,bridge=${bridge}`,
      cpu: "host",
    }),
  );

  const configPath = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/config`;
  log(`Adding EFI disk for vmid ${vmid} …`);
  await pveJsonRequest(
    "PUT",
    apiBase,
    configPath,
    authorization,
    rejectUnauthorized,
    pveFormBody({
      efidisk0: `${storage}:1,efitype=4m,pre-enrolled-keys=1,size=4M`,
    }),
  );

  log(`Downloading ${xzName} on ${sshHost} (if missing) …`);
  sshChecked(
    sshUser,
    sshHost,
    `set -euo pipefail; mkdir -p ${JSON.stringify(imageDir)}; ` +
      `if [ ! -f ${JSON.stringify(qcow2Path)} ]; then ` +
      `if [ ! -f ${JSON.stringify(xzPath)} ]; then wget -q -O ${JSON.stringify(xzPath)} ${JSON.stringify(downloadUrl)}; fi; ` +
      `unxz -f ${JSON.stringify(xzPath)}; fi`,
  );

  log(`Importing ${qcow2Name} into ${storage} …`);
  const importPath = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/importdisk`;
  let importedViaApi = false;
  try {
    const importBody = await pveJsonRequest(
      "POST",
      apiBase,
      importPath,
      authorization,
      rejectUnauthorized,
      pveFormBody({
        storage,
        filename: qcow2Path,
        format: "qcow2",
      }),
    );
    const importUpid = pveData(importBody);
    if (typeof importUpid === "string" && importUpid.trim().startsWith("UPID:")) {
      await waitForPveTask({
        apiBase,
        node,
        upid: importUpid.trim(),
        authorization,
        rejectUnauthorized,
        timeoutMs: 600_000,
        log,
      });
    }
    importedViaApi = true;
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    if (!/501|not implemented/i.test(msg)) {
      throw e;
    }
    log(`importdisk API unavailable on ${node} — using qm importdisk over SSH …`);
    sshChecked(
      sshUser,
      sshHost,
      `qm importdisk ${vmid} ${JSON.stringify(qcow2Path)} ${JSON.stringify(storage)} --format qcow2`,
    );
  }
  if (!importedViaApi) {
    log(`qm importdisk completed on ${sshHost}.`);
  }

  const scsi0 = `${storage}:vm-${vmid}-disk-0`;
  log(`Attaching ${scsi0} and setting boot order …`);
  await pveJsonRequest(
    "PUT",
    apiBase,
    configPath,
    authorization,
    rejectUnauthorized,
    pveFormBody({
      scsi0: `${scsi0},discard=on`,
      boot: "order=scsi0",
      serial0: "socket",
      vga: "serial0",
    }),
  );

  if (rootfsGb > 0) {
    const resizePath = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/resize`;
    log(`Resizing scsi0 to ${rootfsGb}G …`);
    try {
      const resizeBody = await pveJsonRequest(
        "PUT",
        apiBase,
        resizePath,
        authorization,
        rejectUnauthorized,
        pveFormBody({ disk: "scsi0", size: `${rootfsGb}G` }),
      );
      const resizeUpid = extractPveUpid(pveData(resizeBody));
      if (resizeUpid) {
        await waitForPveTask({
          apiBase,
          node,
          upid: resizeUpid,
          authorization,
          rejectUnauthorized,
          timeoutMs: 300_000,
          log,
        });
      }
    } catch (e) {
      log(`Resize skipped or failed (${/** @type {Error} */ (e).message}) — disk may already be large enough.`);
    }
  }

  return { vmid, node, name, imageStorage, storage, release };
}
