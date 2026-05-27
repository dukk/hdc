#!/usr/bin/env node
/**
 * Deploy Windows 11 desktop on Proxmox QEMU from ISO + autounattend.xml (OEM MSDM/SLIC).
 *
 * Usage: hdc run service windows-desktop deploy -- [--instance a | --system-id vm-win11-a]
 *        [--destroy-existing] [--skip-provision] [--skip-oem] [--skip-install]
 *        [--wait-install] [--install-timeout-minutes 90]
 *        [--skip-existing | --redeploy-existing]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { parseArgvFlags, flagGet, flagNumber } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { createNodeCliDeps } from "../../../../tools/hdc/lib/node-cli-deps.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { fetchClusterVmResources } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import {
  allocateNextVmid,
  locateGuest,
  stopAndDestroyQemu,
} from "../../bind/lib/proxmox-qemu-redeploy.mjs";
import { discoverLocalSshMaterial } from "../../../../tools/hdc/lib/ssh-host-access.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { resolvePveSshForHost } from "../../ollama/lib/lxc-password.mjs";

import {
  adminUsername,
  adminVaultKey,
  localeId,
  resolveWindowsDesktopDeployments,
} from "../lib/deployments.mjs";
import {
  autounattendIsoBasename,
  buildAndUploadAutounattendIso,
} from "../lib/autounattend-iso.mjs";
import { verifyIsoVolidsOnNode } from "../lib/iso-preflight.mjs";
import { ensureOemLicenseForVm } from "../lib/oem-apply.mjs";
import { promptExistingGuestAction } from "../lib/prompt-existing.mjs";
import {
  createWindows11QemuVm,
  startQemuGuest,
  waitForWindowsInstallWindow,
} from "../lib/proxmox-windows-vm.mjs";
import {
  assertNoProductKeyInUnattend,
  renderAutounattendXml,
} from "../lib/windows-unattend.mjs";
import { createWindowsDesktopVaultAccess, resolveAdminPassword } from "../lib/vault-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/windows-desktop/config.example.json";
const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

/**
 * @param {Record<string, string>} flags
 */
function destroyPolicy(flags) {
  return flagGet(flags, "destroy-existing") !== undefined;
}

function skipProvision(flags) {
  return flagGet(flags, "skip-provision") !== undefined;
}

function skipOem(flags) {
  return flagGet(flags, "skip-oem") !== undefined;
}

function skipInstall(flags) {
  return flagGet(flags, "skip-install") !== undefined;
}

function existingGuestPolicy(flags) {
  if (flagGet(flags, "skip-existing") !== undefined) return "skip";
  if (flagGet(flags, "redeploy-existing") !== undefined) return "redeploy";
  if (destroyPolicy(flags)) return "destroy";
  return "prompt";
}

/**
 * @param {ReturnType<typeof resolveWindowsDesktopDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {string} adminPassword
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
async function deployOne(deployment, flags, adminPassword, log) {
  const inv = deployTargetInventory(root, target, { systemIdOverride: deployment.systemId });
  logDeployInventoryStatus(target, verb, inv);

  if (skipProvision(flags)) {
    errout.write(`[hdc] ${target} ${verb}: --skip-provision set — nothing to do.\n`);
    return { ok: true, system_id: deployment.systemId, skipped: true };
  }

  const px = deployment.proxmox;
  const hostId = px.hostId;
  const q = px.qemu;
  const net = px.network;
  const iso = px.iso;
  const oem = px.oem;

  errout.write(
    `[hdc] ${target} ${verb}: ${deployment.systemId} on ${hostId} (proxmox-qemu-iso) …\n`,
  );

  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
  const resources = await fetchClusterVmResources(
    auth.host.apiBase,
    auth.authorization,
    auth.rejectUnauthorized,
  );

  let vmid = typeof q.vmid === "number" && Number.isFinite(q.vmid) && q.vmid > 0 ? q.vmid : null;
  if (!vmid) {
    vmid = allocateNextVmid(resources, 200);
    errout.write(`[hdc] ${target} ${verb}: auto-allocated vmid ${vmid}.\n`);
  }

  const located = await locateGuest(
    auth.host.apiBase,
    auth.authorization,
    auth.rejectUnauthorized,
    vmid,
  );
  const policy = existingGuestPolicy(flags);

  if (located) {
    let action = policy;
    if (policy === "prompt") {
      action = await promptExistingGuestAction(
        deployment.systemId,
        vmid,
        located.node,
        located.name,
      );
    }
    if (action === "skip") {
      errout.write(`[hdc] ${target} ${verb}: skipping ${deployment.systemId} (vmid ${vmid} exists).\n`);
      return { ok: true, system_id: deployment.systemId, skipped: true, vmid };
    }
    if (action === "destroy" || policy === "destroy") {
      await stopAndDestroyQemu({
        apiBase: auth.host.apiBase,
        authorization: auth.authorization,
        rejectUnauthorized: auth.rejectUnauthorized,
        node: located.node,
        vmid,
        log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      });
    } else {
      return {
        ok: false,
        system_id: deployment.systemId,
        message: "guest exists — use --destroy-existing to rebuild",
        vmid,
      };
    }
  }

  const node = auth.host.pveNode;
  const windowsVolid = String(iso.windows_volid ?? "").trim();
  const virtioVolid = String(iso.virtio_volid ?? "").trim();
  const isoStorage =
    (typeof q.iso_storage === "string" && q.iso_storage.trim()) ||
    (typeof iso.virtio_volid === "string" ? String(iso.virtio_volid).split(":")[0] : "local");

  const xml = renderAutounattendXml({
    computerName: deployment.hostname,
    adminUsername: adminUsername(deployment),
    adminPassword,
    locale: localeId(deployment),
    network:
      typeof q.ip === "string" && q.ip.trim() && typeof net.gateway === "string"
        ? {
            ipCidr: q.ip.trim(),
            gateway: net.gateway.trim(),
            dnsServers: Array.isArray(net.dns) ? net.dns.map(String) : [],
          }
        : undefined,
  });
  assertNoProductKeyInUnattend(xml);

  const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
  const sshTarget = { id: hostId, host: pveSsh.host, user: pveSsh.user, clusterId: null };
  const { identities } = discoverLocalSshMaterial();
  const deps = createNodeCliDeps();

  const autounattendBasename = autounattendIsoBasename(deployment.systemId);
  const autounattendVolid = await buildAndUploadAutounattendIso({
    sshTarget,
    xml,
    isoStorage,
    basename: autounattendBasename,
    spawnSync: deps.spawnSync,
    env: deps.env,
    identities,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });

  await verifyIsoVolidsOnNode({
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node,
    windowsVolid,
    virtioVolid,
    autounattendVolid,
  });

  const storage = typeof q.storage === "string" ? q.storage.trim() : "local-lvm";
  const memoryMb = Number(q.memory_mb) || 8192;
  const cores = Number(q.cores) || 4;
  const diskGb = Number(q.disk_gb) || 128;
  const bridge = typeof net.bridge === "string" ? net.bridge.trim() : "vmbr0";
  const machine = typeof q.machine === "string" ? q.machine.trim() : "q35";
  const cpu = typeof q.cpu === "string" ? q.cpu.trim() : "host";
  const tpmVersion = typeof q.tpm_version === "string" ? q.tpm_version.trim() : "v2.0";

  await createWindows11QemuVm({
    apiBase: auth.host.apiBase,
    node,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    vmid,
    name: deployment.hostname,
    memoryMb,
    cores,
    machine,
    storage,
    diskGb,
    bridge,
    windowsIsoVolid: windowsVolid,
    virtioIsoVolid: virtioVolid,
    autounattendIsoVolid: autounattendVolid,
    cpu,
    tpmVersion,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });

  if (!skipOem(flags) && oem.enabled !== false && oem.enabled !== 0) {
    await ensureOemLicenseForVm({
      sshTarget,
      pveNode: node,
      apiBase: auth.host.apiBase,
      node,
      vmid,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
      spawnSync: deps.spawnSync,
      env: deps.env,
      requireFirmware: oem.require_firmware !== false && oem.require_firmware !== 0,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      warn: (line) => errout.write(`[hdc] ${target} ${verb}: WARN ${line}\n`),
    });
  } else {
    errout.write(`[hdc] ${target} ${verb}: OEM passthrough skipped.\n`);
  }

  /** @type {{ install_wait?: Record<string, unknown> }} */
  const extra = {};

  if (!skipInstall(flags)) {
    await startQemuGuest({
      apiBase: auth.host.apiBase,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
      node,
      vmid,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });

    if (flagGet(flags, "wait-install") !== undefined) {
      const minutes = flagNumber(flagGet(flags, "install-timeout-minutes"), 90) ?? 90;
      extra.install_wait = await waitForWindowsInstallWindow({
        apiBase: auth.host.apiBase,
        node,
        vmid,
        authorization: auth.authorization,
        rejectUnauthorized: auth.rejectUnauthorized,
        timeoutMs: minutes * 60_000,
        log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      });
    }
  } else {
    errout.write(`[hdc] ${target} ${verb}: VM created but not started (--skip-install).\n`);
  }

  return {
    ok: true,
    system_id: deployment.systemId,
    host_id: hostId,
    vmid,
    node,
    hostname: deployment.hostname,
    autounattend_volid: autounattendVolid,
    ...extra,
  };
}

async function main() {
  const flags = parseArgvFlags(process.argv.slice(2));
  const log = provisionLogFromConsole(console);
  const deps = createNodeCliDeps();
  const cfg = ensurePackageConfig().data;

  errout.write(`[hdc] ${target} ${verb}: Windows 11 QEMU deploy (stderr log; JSON on stdout).\n`);

  const vault = createWindowsDesktopVaultAccess(deps);
  await vault.unlock({});

  /** @type {Record<string, unknown>[]} */
  const results = [];
  let ok = true;

  try {
    const deployments = resolveWindowsDesktopDeployments(cfg, flags);
    const adminKey = adminVaultKey(deployments[0]);
    const adminPassword = await resolveAdminPassword(vault, adminKey, deps.readLineQuestion);

    for (const deployment of deployments) {
      try {
        const r = await deployOne(deployment, flags, adminPassword, log);
        results.push(r);
        if (!r.ok) ok = false;
      } catch (e) {
        ok = false;
        const msg = String(/** @type {Error} */ (e).message || e);
        errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
        results.push({ ok: false, system_id: deployment.systemId, message: msg });
      }
    }
  } catch (e) {
    ok = false;
    errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).message || e}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const payload = { ok, target, verb, results };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  await runOperationReportTail({
    packageRoot,
    packageId: target,
    verb,
    ok,
    argv: process.argv.slice(2),
    stdoutPayload: payload,
    repoRoot: root,
    readLineQuestion: deps.readLineQuestion,
  });

  process.exitCode = ok ? 0 : 1;
}

main();
