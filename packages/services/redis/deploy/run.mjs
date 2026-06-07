#!/usr/bin/env node
/**
 * Deploy Redis Cluster on Proxmox QEMU (3 masters) or configure-only.
 *
 * Usage: hdc run service redis deploy -- [--instance a|b|c] [--destroy-existing] [--skip-provision]
 *        [--skip-cluster-bootstrap] [--skip-install] [--skip-existing] [--redeploy-existing]
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
import { createRedisVaultAccess } from "../lib/vault-deps.mjs";
import {
  clusterEndpointsFromDeployments,
  normalizeRedisConfig,
  redisGlobalSettings,
  resolveRedisDeployments,
  sshHostFromDeployment,
  sshUserFromDeployment,
} from "../lib/deployments.mjs";
import { configureRedis, createConfigureExec } from "../lib/redis-configure.mjs";
import {
  bootstrapRedisCluster,
  clusterAlreadyInitialized,
} from "../lib/redis-cluster.mjs";
import {
  applyQemuCloudInit,
  cloneQemuGuest,
  locateGuest,
  startQemuGuest,
  stopAndDestroyQemu,
  waitForQemuGuestSshAfterBoot,
} from "../lib/proxmox-qemu-redeploy.mjs";
import { promptExistingGuestAction } from "../lib/prompt-existing.mjs";
import { ensureQemuGuestAgentOnDeploy } from "../../../infrastructure/proxmox/lib/proxmox-qemu-guest-agent-install.mjs";
import { guestResourceOptsFromBlock } from "../../../infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import { waitForCloneTaskAndEnableAgent } from "../../../infrastructure/proxmox/lib/proxmox-qemu-post-clone.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/redis/config.example.json";
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
function skipClusterBootstrap(flags) {
  return flagGet(flags, "skip-cluster-bootstrap") !== undefined;
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
 * @param {ReturnType<typeof resolveRedisDeployments>[number]} deployment
 * @param {ReturnType<typeof redisGlobalSettings>} global
 * @param {string} password
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
function runConfigure(deployment, global, password, log) {
  const host = sshHostFromDeployment(deployment);
  const user = sshUserFromDeployment(deployment);
  if (!host) {
    throw new Error(`${deployment.systemId}: configure.ssh.host required`);
  }
  const exec = createConfigureExec("ssh", { user, host });
  return configureRedis({
    exec,
    log,
    announceIp: host,
    port: global.port,
    password,
    maxmemory: global.maxmemory,
    maxmemoryPolicy: global.maxmemoryPolicy,
    runInstall: deployment.install.enabled !== false,
  });
}

/**
 * @param {ReturnType<typeof resolveRedisDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {ReturnType<typeof redisGlobalSettings>} global
 * @param {string} password
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
async function deployOne(deployment, flags, global, password, log) {
  const inv = deployTargetInventory(root, target, { systemIdOverride: deployment.systemId });
  logDeployInventoryStatus(target, verb, inv);

  if (skipProvision(flags) || deployment.mode === "configure-only") {
    errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} configure-only …\n`);
    const configure = runConfigure(deployment, global, password, log);
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

  errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} on ${hostId} vmid ${vmid} …\n`);
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
      return {
        ok: true,
        system_id: deployment.systemId,
        skipped_provision: true,
        message: "skipped existing guest",
      };
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
      const configure = runConfigure(deployment, global, password, log);
      return {
        ok: true,
        system_id: deployment.systemId,
        skipped_provision: true,
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

  const sshHost =
    sshHostFromDeployment(deployment) || (typeof ip === "string" ? ip.split("/")[0] : "");
  let sshUser = sshUserFromDeployment(deployment);

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

  const configure = runConfigure(
    {
      ...deployment,
      configure: { ssh: { user: sshUser, host: sshHost } },
    },
    global,
    password,
    log,
  );

  return {
    ok: true,
    system_id: deployment.systemId,
    provision: provisionResult,
    configure,
  };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Redis Cluster (stderr log; JSON on stdout).\n`);

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
  let deployments;
  try {
    normalized = normalizeRedisConfig(cfg);
    deployments = resolveRedisDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const global = redisGlobalSettings(normalized);
  const vault = createRedisVaultAccess();
  errout.write(
    `[hdc] ${target} ${verb}: loading Redis password from vault key ${global.passwordVaultKey} …\n`,
  );
  await vault.unlock({});
  const password = String(
    await vault.getSecret(global.passwordVaultKey, {
      promptLabel: `vault secret ${global.passwordVaultKey}`,
    }),
  ).trim();
  if (!password) {
    errout.write(
      `[hdc] ${target} ${verb}: password empty — hdc secrets set ${global.passwordVaultKey}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "missing Redis password" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (deployments.length > 1) {
    errout.write(`[hdc] ${target} ${verb}: deploying ${deployments.length} node(s) …\n`);
  }

  const log = provisionLogFromConsole(console);
  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const deployment of deployments) {
    try {
      results.push(await deployOne(deployment, flags, global, password, log));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      results.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  /** @type {Record<string, unknown> | null} */
  let cluster = null;
  const shouldBootstrap =
    !skipClusterBootstrap(flags) &&
    deployments.length === global.minMasters &&
    results.every((r) => r.ok && r.configure);

  if (shouldBootstrap) {
    const endpoints = clusterEndpointsFromDeployments(deployments, global).map((e) => ({
      host: e.host,
      port: e.port,
    }));
    const first = deployments[0];
    const user = sshUserFromDeployment(first);
    const host = sshHostFromDeployment(first);
    errout.write(`[hdc] ${target} ${verb}: cluster bootstrap check on ${user}@${host} …\n`);

    if (clusterAlreadyInitialized(user, host, global.port, password)) {
      errout.write(`[hdc] ${target} ${verb}: cluster already initialized — skipping create.\n`);
      cluster = { bootstrapped: false, skipped: true, reason: "already_initialized" };
    } else {
      errout.write(`[hdc] ${target} ${verb}: creating Redis cluster (${endpoints.length} masters) …\n`);
      const boot = bootstrapRedisCluster({
        user,
        host,
        port: global.port,
        password,
        endpoints,
        replicas: global.clusterReplicas,
      });
      cluster = {
        bootstrapped: boot.ok,
        ok: boot.ok,
        output: boot.output?.slice(0, 2000),
      };
      if (!boot.ok) {
        errout.write(`[hdc] ${target} ${verb}: cluster bootstrap failed.\n`);
      }
    }
  }

  const nodesOk = results.every((r) => r.ok);
  const clusterOk = cluster === null || cluster.skipped === true || cluster.ok === true;
  const ok = nodesOk && clusterOk;
  process.stdout.write(
    `${JSON.stringify({ ok, target, verb, count: results.length, results, cluster }, null, 2)}\n`,
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
