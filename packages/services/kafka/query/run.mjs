#!/usr/bin/env node
import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
/**
 * Query Kafka broker health on configured nodes.
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";
import {
  kafkaGlobalSettings,
  normalizeKafkaConfig,
  resolveKafkaDeployments,
} from "../lib/deployments.mjs";
import { queryBrokerApiVersions, queryKafkaServiceActive } from "../lib/kafka-query-remote.mjs";
import { createConfigureExec } from "../lib/kafka-configure.mjs";
import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
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

const target = basename(dirname(here));
const verb = basename(here);

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Kafka health check (JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  let global;
  let deployments;
  try {
    const normalized = normalizeKafkaConfig(cfg);
    global = kafkaGlobalSettings(normalized);
    deployments = resolveKafkaDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    errout.write(`[hdc] ${target} ${verb}: ${msg}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  /** @type {Record<string, unknown>[]} */
  const nodes = [];

  for (const d of deployments) {
    const ssh = isObject(d.configure) && isObject(d.configure.ssh) ? d.configure.ssh : {};
    const user = resolveGuestSshUser(ssh.user);
    const host = d.sshHost;
    errout.write(`[hdc] ${target} ${verb}: checking ${d.systemId} node ${d.nodeId} at ${user}@${host} …\n`);

    const exec = createConfigureExec("ssh", { user, host });
    const service = queryKafkaServiceActive(exec);
    const api = queryBrokerApiVersions(exec, global.listenerPort);
    nodes.push({
      system_id: d.systemId,
      node_id: d.nodeId,
      host,
      service,
      broker_api: api,
      ok: service.active && api.ok,
    });
  }

  const ok = nodes.length > 0 && nodes.every((n) => n.ok);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        target,
        verb,
        cluster_id: global.clusterId,
        bootstrap: nodes.map((n) => `${n.host}:${global.listenerPort}`),
        nodes,
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

