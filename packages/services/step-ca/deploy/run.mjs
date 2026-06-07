#!/usr/bin/env node
/**
 * Deploy step-ca on Proxmox QEMU (standalone internal CA).
 *
 * Usage: hdc run service step-ca deploy -- [--instance a | --system-id vm-step-ca-a]
 *        [--destroy-existing] [--skip-provision] [--skip-install]
 *        [--skip-existing | --redeploy-existing]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { createProxmoxHostProvisioner } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { ensureQemuGuestAgentOnDeploy } from "../../../infrastructure/proxmox/lib/proxmox-qemu-guest-agent-install.mjs";
import { guestResourceOptsFromBlock } from "../../../infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import { waitForCloneTaskAndEnableAgent } from "../../../infrastructure/proxmox/lib/proxmox-qemu-post-clone.mjs";
import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
import { configureStepCaServer, createConfigureExec } from "../lib/step-ca-configure.mjs";
import {
  normalizeStepCaConfig,
  resolveStepCaDeployments,
  stepCaGlobalSettings,
} from "../lib/deployments.mjs";
import { caPasswordVaultKey, instanceLetterFromSystemId } from "../lib/inventory.mjs";
import { promptExistingGuestAction } from "../lib/prompt-existing.mjs";
import {
  applyQemuCloudInit,
  cloneQemuGuest,
  locateGuest,
  startQemuGuest,
  stopAndDestroyQemu,
  waitForQemuGuestSshAfterBoot,
} from "../lib/proxmox-qemu-redeploy.mjs";
import { createStepCaVaultAccess } from "../lib/vault-deps.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import {
  growRootFilesystemInGuest,
  resizeQemuScsi0OnHypervisor,
  resolveRootfsGbFromDeployment,
  syncQemuRootfsOnMaintain,
} from "../../../lib/qemu-rootfs-resize.mjs";
import { resolvePveSshForHost } from "../../ollama/lib/ollama-install.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/step-ca/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readCfg() {
  return ensurePackageConfig().data;
}

/**
 * @param {Record<string, string>} flags
 */
function destroyPolicy(flags) {
  return flagGet(flags, "destroy-existing") !== undefined;
}

/**
 * @param {Record<string, string>} flags
 */
function skipProvision(flags) {
  return flagGet(flags, "skip-provision") !== undefined;
}

/**
 * @param {Record<string, string>} flags
 */
function existingGuestPolicy(flags) {
  if (flagGet(flags, "skip-existing") !== undefined) return "skip";
  if (flagGet(flags, "redeploy-existing") !== undefined) return "redeploy";
  if (destroyPolicy(flags)) return "destroy";
  return "prompt";
}

/**
 * @param {object} ctx
 */
async function runConfigure(ctx) {
  const { deployment, global, caPassword, log } = ctx;

  if (deployment.install.enabled === false) {
    errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} install disabled — skipping configure.\n`);
    return { ok: true, skipped: true, message: "install disabled" };
  }

  const cfg = deployment.configure;
  const ssh = isObject(cfg) && isObject(cfg.ssh) ? cfg.ssh : {};
  const user = resolveGuestSshUser(ssh.user);
  const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : "";
  if (!host) {
    throw new Error(`${deployment.systemId}: configure.ssh.host required`);
  }
  const exec = createConfigureExec("ssh", { user, host });

  return configureStepCaServer({
    exec,
    log,
    global,
    caPassword,
    restartService: true,
  });
}

/**
 * @param {ReturnType<typeof resolveStepCaDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {ReturnType<typeof stepCaGlobalSettings>} global
 * @param {string} caPassword
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
async function deployOne(deployment, flags, global, caPassword, log) {
  const inv = deployTargetInventory(root, target, { systemIdOverride: deployment.systemId });
  logDeployInventoryStatus(target, verb, inv);

  if (skipProvision(flags) || deployment.mode === "configure-only") {
    errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} configure-only …\n`);
    const configure = await runConfigure({ deployment, global, caPassword, log });
    return { ok: true, system_id: deployment.systemId, mode: "configure-only", configure };
  }

  const px = deployment.proxmox;
  if (!isObject(px)) {
    return { ok: false, system_id: deployment.systemId, message: "missing proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) {
    return { ok: false, system_id: deployment.systemId, message: "missing host_id" };
  }
  const q = isObject(px.qemu) ? px.qemu : {};
  const net = isObject(px.network) ? px.network : {};
  const vmid = typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
  const templateVmid = typeof q.template_vmid === "number" ? q.template_vmid : Number(q.template_vmid);
  const ip = typeof q.ip === "string" ? q.ip.trim() : "";
  const gateway =
    typeof net.gateway === "string" && net.gateway.trim()
      ? net.gateway.trim()
      : typeof q.gateway === "string"
        ? q.gateway.trim()
        : "192.0.2.1";
  const hostname =
    deployment.hostname ||
    (typeof q.name === "string" && q.name.trim() ? q.name.trim() : deployment.systemId.replace(/^vm-/, ""));

  if (!Number.isFinite(vmid) || vmid <= 0 || !Number.isFinite(templateVmid) || templateVmid <= 0 || !ip) {
    return { ok: false, system_id: deployment.systemId, message: "invalid qemu vmid, template_vmid, or ip" };
  }

  errout.write(
    `[hdc] ${target} ${verb}: ${deployment.systemId} (${deployment.role}) on ${hostId} vmid ${vmid} …\n`,
  );
  const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId });
  const located = await locateGuest(auth.host.apiBase, auth.authorization, auth.rejectUnauthorized, vmid);
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
      errout.write(`[hdc] ${target} ${verb}: skipping provision for ${deployment.systemId}.\n`);
      return { ok: true, system_id: deployment.systemId, skipped_provision: true };
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
      errout.write(
        `[hdc] ${target} ${verb}: guest exists — configure only (use --destroy-existing to rebuild).\n`,
      );
      const logLine = (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`);
      const diskResize = await syncQemuRootfsOnMaintain({
        proxmoxPackageRoot: proxmoxRoot,
        deployment,
        flags,
        log: logLine,
      });
      const configure = await runConfigure({ deployment, global, caPassword, log });
      return {
        ok: true,
        system_id: deployment.systemId,
        role: deployment.role,
        skipped_provision: true,
        disk_resize: diskResize,
        configure,
      };
    }
  }

  const prov = createProxmoxHostProvisioner({
    apiBase: auth.host.apiBase,
    pveNode: auth.host.pveNode,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
  });

  const provisionResult = await cloneQemuGuest({
    log,
    provisioner: prov,
    name: hostname,
    vmid,
    templateVmid,
    parameters: { ...q, vmid, template_vmid: templateVmid },
  });

  if (!provisionResult.ok) {
    return {
      ok: false,
      system_id: deployment.systemId,
      role: deployment.role,
      provision: provisionResult,
    };
  }

  const { node: cloneNode, vmid: guestVmid } = await waitForCloneTaskAndEnableAgent(
    provisionResult,
    auth,
    vmid,
    (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    guestResourceOptsFromBlock(q, flags),
  );

  const rootfsGb = resolveRootfsGbFromDeployment(deployment);
  if (rootfsGb) {
    const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
    resizeQemuScsi0OnHypervisor({
      sshUser: pveSsh.user,
      sshHost: pveSsh.host,
      vmid: guestVmid,
      rootfsGb,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });
  }

  await applyQemuCloudInit({
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node: cloneNode,
    vmid: guestVmid,
    hostname,
    ipCidr: ip,
    gateway,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });

  await startQemuGuest({
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node: cloneNode,
    vmid: guestVmid,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });

  const sshCfg = isObject(deployment.configure) && isObject(deployment.configure.ssh)
    ? deployment.configure.ssh
    : {};
  let sshUser = resolveGuestSshUser(sshCfg.user);
  const sshHost = typeof sshCfg.host === "string" && sshCfg.host.trim() ? sshCfg.host.trim() : ip.split("/")[0];

  const sshWait = await waitForQemuGuestSshAfterBoot({
    user: sshUser,
    host: sshHost,
    apiBase: auth.host.apiBase,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    node: cloneNode,
    vmid: guestVmid,
    freshClone: true,
    proxmoxPackageRoot: proxmoxRoot,
    flags,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });
  sshUser = sshWait.user;

  if (rootfsGb) {
    const exec = createConfigureExec("ssh", { user: sshUser, host: sshHost });
    growRootFilesystemInGuest({ exec, log });
  }

  await ensureQemuGuestAgentOnDeploy({
    apiBase: auth.host.apiBase,
    node: cloneNode,
    vmid: guestVmid,
    authorization: auth.authorization,
    rejectUnauthorized: auth.rejectUnauthorized,
    sshUser,
    sshHost,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });

  const configure = await runConfigure({
    deployment: {
      ...deployment,
      configure: { ssh: { user: sshUser, host: sshHost } },
    },
    global,
    caPassword,
    log,
  });

  return {
    ok: true,
    system_id: deployment.systemId,
    role: deployment.role,
    provision: provisionResult,
    configure,
  };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: step-ca deploy (stderr log; JSON on stdout).\n`);

  if (!existsSync(ensurePackageConfig().path)) {
    const inv = deployTargetInventory(root, target);
    logDeployInventoryStatus(target, verb, inv);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing — see stderr" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  let normalized;
  let toDeploy;
  try {
    normalized = normalizeStepCaConfig(cfg);
    toDeploy = resolveStepCaDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const global = stepCaGlobalSettings(normalized);
  const vault = createStepCaVaultAccess();
  await vault.unlock({});

  const log = provisionLogFromConsole(console);
  /** @type {Record<string, unknown>[]} */
  const results = [];

  const stepCaBlock = isObject(normalized.stepCa) ? normalized.stepCa : {};

  for (const deployment of toDeploy) {
    const letter = instanceLetterFromSystemId(deployment.systemId);
    const pwKey = caPasswordVaultKey(stepCaBlock, letter);
    errout.write(`[hdc] ${target} ${verb}: loading CA password ${pwKey} for ${deployment.systemId} …\n`);
    const caPassword = String(
      await vault.getSecret(pwKey, { promptLabel: `vault secret ${pwKey}` }),
    ).trim();
    if (!caPassword) {
      results.push({
        ok: false,
        system_id: deployment.systemId,
        message: `missing CA password (${pwKey})`,
      });
      continue;
    }

    try {
      results.push(await deployOne(deployment, flags, global, caPassword, log));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      results.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  const ok = results.every((r) => r.ok !== false);
  process.stdout.write(
    `${JSON.stringify({ ok, target, verb, count: results.length, results }, null, 2)}\n`,
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
