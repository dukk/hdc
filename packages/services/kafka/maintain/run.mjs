#!/usr/bin/env node
/**
 * Re-apply Kafka server.properties and rolling-restart brokers.
 *
 * Usage: hdc run service kafka maintain -- [--skip-clamav]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";
import {
  kafkaGlobalSettings,
  normalizeKafkaConfig,
  resolveAllKafkaDeployments,
  resolveKafkaDeployments,
} from "../lib/deployments.mjs";
import { configureKafkaNode, createConfigureExec } from "../lib/kafka-configure.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/kafka/config.example.json";
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

const root = repoRoot();

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {ReturnType<typeof resolveKafkaDeployments>[number]} deployment
 */
function sshFromDeployment(deployment) {
  const cfg = isObject(deployment.configure) ? deployment.configure : {};
  const ssh = isObject(cfg.ssh) ? cfg.ssh : {};
  const user = typeof ssh.user === "string" && ssh.user.trim() ? ssh.user.trim() : "root";
  const host = deployment.sshHost;
  if (!host) throw new Error(`${deployment.systemId}: configure.ssh.host required`);
  return { user, host };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Kafka config sync and rolling restart (stderr log; JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});
  let normalized;
  let global;
  let allDeployments;
  let deployments;
  try {
    normalized = normalizeKafkaConfig(cfg);
    global = kafkaGlobalSettings(normalized);
    allDeployments = resolveAllKafkaDeployments(cfg);
    deployments = resolveKafkaDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const log = provisionLogFromConsole(console);
  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const deployment of deployments) {
    const ssh = sshFromDeployment(deployment);
    errout.write(
      `[hdc] ${target} ${verb}: ${deployment.systemId} node ${deployment.nodeId} ${ssh.user}@${ssh.host} …\n`,
    );
    try {
      const exec = createConfigureExec("ssh", ssh);
      const configure = await configureKafkaNode({
        exec,
        allDeployments,
        deployment,
        global,
        restart: true,
      });
      const baseline = await ensureGuestLinuxBaseline({ exec, log, flags, vaultAccess, deployment, proxmoxPackageRoot: proxmoxRoot });
      results.push({
        system_id: deployment.systemId,
        node_id: deployment.nodeId,
        host: ssh.host,
        ok: configure.ok && clamav.ok,
        configure,
        admin_user: baseline.admin_user,
        clamav: baseline.clamav,
      });
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      results.push({
        system_id: deployment.systemId,
        node_id: deployment.nodeId,
        ok: false,
        message: msg,
      });
    }
  }

  const ok = results.length > 0 && results.every((r) => r.ok);
  const payload = {
    ok,
    target,
    verb,
    cluster_id: global.clusterId,
    results,
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
