#!/usr/bin/env node
/**
 * Maintain Valkey Cluster nodes: re-apply config, optional apt upgrade, cluster check.
 *
 * Usage: hdc run service valkey maintain -- [--instance a|b|c] [--skip-apt]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import {
  clusterEndpointsFromDeployments,
  normalizeValkeyConfig,
  valkeyGlobalSettings,
  resolveValkeyDeployments,
  sshHostFromDeployment,
  sshUserFromDeployment,
} from "../lib/deployments.mjs";
import { configureValkey, createConfigureExec } from "../lib/valkey-configure.mjs";
import { aptUpgradeValkeyCommand } from "../lib/valkey-install.mjs";
import { runClusterCheck } from "../lib/valkey-cluster.mjs";
import { createValkeyVaultAccess } from "../lib/vault-deps.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/valkey/config.example.json";
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

const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();

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
  errout.write(`[hdc] ${target} ${verb}: Valkey Cluster maintain (stderr log; JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const skipApt = flagGet(flags, "skip-apt") !== undefined;

  let normalized;
  let deployments;
  try {
    normalized = normalizeValkeyConfig(cfg);
    deployments = resolveValkeyDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const global = valkeyGlobalSettings(normalized);
  const vault = createValkeyVaultAccess();
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
      `${JSON.stringify({ ok: false, target, verb, message: "missing Valkey password" }, null, 2)}\n`,
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
        runChecked(exec, aptUpgradeValkeyCommand(), log);
      }
      const configure = configureValkey({
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
        admin_user: baseline.admin_user,
        clamav: baseline.clamav,
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

  const payload = {
    ok,
    target,
    verb,
    nodes,
    cluster_check: clusterCheck,
    generated_at: new Date().toISOString(),
  };
  runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
