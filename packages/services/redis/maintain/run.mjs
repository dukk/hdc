import { guestBaselineResultFields, guestBaselineUsersOk } from "../../../lib/guest-baseline-report.mjs";
#!/usr/bin/env node
/**
 * Maintain Redis Cluster nodes: re-apply config, optional apt upgrade, cluster check.
 *
 * Usage: hdc run service redis maintain -- [--instance a|b|c] [--skip-apt]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  clusterEndpointsFromDeployments,
  normalizeRedisConfig,
  redisGlobalSettings,
  resolveRedisDeployments,
  sshHostFromDeployment,
  sshUserFromDeployment,
} from "../lib/deployments.mjs";
import { configureRedis, createConfigureExec } from "../lib/redis-configure.mjs";
import { aptUpgradeRedisCommand } from "../lib/redis-install.mjs";
import { runClusterCheck } from "../lib/redis-cluster.mjs";
import { createRedisVaultAccess } from "../lib/vault-deps.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


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
function readCfg() {
  return ensurePackageConfig().data;
}
function tryCfg() {
  return tryLoadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
}

const target = basename(dirname(here));
const verb = basename(here);

/**
 * @param {ReturnType<typeof createConfigureExec>} exec
 * @param {string} cmd
 * @param {import("../../../lib/host-provisioner.mjs").ProvisionLog} log
 */
function runChecked(exec, cmd, log) {
  log.info(`${exec.label}: ${cmd.split("\n")[0].slice(0, 100)}`);
  const r = exec.run(cmd, { capture: true });
  if (r.status !== 0) {
    const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
    throw new Error(detail);
  }
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Redis Cluster maintain (stderr log; JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const skipApt = flagGet(flags, "skip-apt") !== undefined;

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
  await vault.unlock({});
  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});
  const password = String(
    await vault.getSecret(global.passwordVaultKey, {
      promptLabel: `vault secret ${global.passwordVaultKey}`,
    }),
  ).trim();
  if (!password) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "missing Redis password" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const log = provisionLogFromConsole(console);
  /** @type {Record<string, unknown>[]} */
  const nodes = [];

  for (const deployment of deployments) {
    const host = sshHostFromDeployment(deployment);
    const user = sshUserFromDeployment(deployment);
    errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} at ${user}@${host} …\n`);
    try {
      const exec = createConfigureExec("ssh", { user, host });
      if (!skipApt) {
        runChecked(exec, aptUpgradeRedisCommand(), log);
      }
      const configure = configureRedis({
        exec,
        log,
        announceIp: host,
        port: global.port,
        password,
        maxmemory: global.maxmemory,
        maxmemoryPolicy: global.maxmemoryPolicy,
        runInstall: false,
      });
      const baseline = await ensureGuestLinuxBaseline({ exec, log, flags, vaultAccess, deployment, proxmoxPackageRoot: proxmoxRoot });
      nodes.push({
        system_id: deployment.systemId,
        host,
        ok: baseline.ok,
        configure,
        apt_upgrade: !skipApt,
        ...guestBaselineResultFields(baseline),
      });
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      nodes.push({ system_id: deployment.systemId, host, ok: false, message: msg });
    }
  }

  /** @type {Record<string, unknown> | null} */
  let clusterCheck = null;
  if (deployments.length === global.minMasters && nodes.every((n) => n.ok)) {
    const endpoints = clusterEndpointsFromDeployments(deployments, global);
    const first = endpoints[0];
    errout.write(`[hdc] ${target} ${verb}: cluster check via ${first.host}:${first.port} …\n`);
    clusterCheck = runClusterCheck(first.user, first.host, first.port, password);
  }

  const nodesOk = nodes.length > 0 && nodes.every((n) => n.ok);
  const clusterOk = clusterCheck === null || clusterCheck.ok;
  const ok = nodesOk && clusterOk;

  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        target,
        verb,
        nodes,
        cluster_check: clusterCheck,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
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
