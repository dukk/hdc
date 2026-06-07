import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
import { guestBaselineResultFields, guestBaselineUsersOk } from "../../../lib/guest-baseline-report.mjs";
#!/usr/bin/env node
/**
 * Re-apply Cassandra config; optional rolling restart.
 *
 * Usage: hdc run service cassandra maintain -- [--rolling-restart] [--skip-clamav]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import {
  cassandraGlobalSettings,
  normalizeCassandraConfig,
  resolveCassandraDeployments,
} from "../lib/deployments.mjs";
import {
  configureCassandra,
  createConfigureExec,
  rollingRestartNode,
  waitForCassandraReady,
} from "../lib/cassandra-configure.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/cassandra/config.example.json";
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

async function main() {
  errout.write(`[hdc] ${target} ${verb}: Cassandra config sync (stderr log; JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});
  const rolling = flagGet(flags, "rolling-restart") !== undefined;
  const normalized = normalizeCassandraConfig(cfg);
  const deployments = resolveCassandraDeployments(cfg, flags);
  const global = cassandraGlobalSettings(normalized, deployments);
  const log = provisionLogFromConsole(console);

  /** @type {Record<string, unknown>[]} */
  const results = [];

  for (const d of deployments) {
    const ssh = isObject(d.configure) && isObject(d.configure.ssh) ? d.configure.ssh : {};
    const user = resolveGuestSshUser(ssh.user);
    const host = typeof ssh.host === "string" ? ssh.host : d.listenIp;
    errout.write(`[hdc] ${target} ${verb}: ${d.systemId} at ${user}@${host} …\n`);
    try {
      const exec = createConfigureExec("ssh", { user, host });
      const rack = d.rack || global.rack;
      if (rolling) {
        rollingRestartNode({ exec, log });
      } else {
        configureCassandra({
          exec,
          log,
          clusterName: global.clusterName,
          seedIps: global.seedIps,
          listenIp: d.listenIp || host,
          datacenter: global.datacenter,
          rack,
          version: global.version,
          memoryMb: d.memoryMb || global.defaultMemoryMb,
          passwordAuthEnabled: global.passwordAuthEnabled,
          skipInstall: true,
        });
      }
      const baseline = await ensureGuestLinuxBaseline({ exec, log, flags, vaultAccess, deployment, proxmoxPackageRoot: proxmoxRoot });
      const ready = await waitForCassandraReady({
        user,
        host,
        listenIp: d.listenIp || host,
        onProgress: (m) => errout.write(`[hdc] ${target} ${verb}: ${m}\n`),
      });
      results.push({
        system_id: d.systemId,
        ok: ready.ok && clamav.ok,
        rolling_restart: rolling,
        ready,
        ...guestBaselineResultFields(baseline),
      });
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      results.push({ system_id: d.systemId, ok: false, message: msg });
    }
  }

  const ok = results.length > 0 && results.every((r) => r.ok);
  const payload = {
    ok,
    target,
    verb,
    rolling_restart: rolling,
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
