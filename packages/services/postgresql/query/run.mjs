import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
#!/usr/bin/env node
/**
 * Query PostgreSQL service health on configured nodes.
 *
 * Usage: hdc run service postgresql query -- [--instance a | --system-id vm-postgres-b]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { parseArgvFlags } from "../../../lib/parse-argv-flags.mjs";import { loadPackageConfigFromPackageRoot, tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

import {
  normalizePostgresqlConfig,
  resolvePostgresqlDeployments,
} from "../lib/deployments.mjs";
import {
  queryPgIsready,
  queryPostgresqlActive,
  queryPostgresqlVersion,
  queryRecoveryStatus,
  queryReplicationLag,
} from "../lib/postgresql-query-remote.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/postgresql/config.example.json";
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
  errout.write(`[hdc] ${target} ${verb}: PostgreSQL health check (JSON on stdout).\n`);

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  let deployments;
  try {
    normalizePostgresqlConfig(cfg);
    deployments = resolvePostgresqlDeployments(cfg, flags);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: msg }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  /** @type {Record<string, unknown>[]} */
  const nodes = [];

  for (const d of deployments) {
    const ssh = isObject(d.configure) && isObject(d.configure.ssh) ? d.configure.ssh : {};
    const user = resolveGuestSshUser(ssh.user);
    const host = typeof ssh.host === "string" ? ssh.host : "";
    if (!host) {
      nodes.push({ system_id: d.systemId, ok: false, message: "missing ssh host" });
      continue;
    }

    errout.write(`[hdc] ${target} ${verb}: checking ${d.systemId} (${d.role}) at ${user}@${host} …\n`);

    const service = queryPostgresqlActive(user, host);
    const ready = queryPgIsready(user, host);
    const version = queryPostgresqlVersion(user, host);
    const recovery = queryRecoveryStatus(user, host);

    /** @type {Record<string, unknown>} */
    const node = {
      system_id: d.systemId,
      role: d.role,
      host,
      service,
      pg_isready: ready,
      version,
      recovery,
      ok: service.active && ready.ok && version.ok,
    };

    if (d.role === "standby" && recovery.in_recovery) {
      const lag = queryReplicationLag(user, host);
      node.replication_lag = lag;
      node.ok = node.ok && lag.ok;
    }

    nodes.push(node);
  }

  const ok = nodes.length > 0 && nodes.every((n) => n.ok);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        target,
        verb,
        nodes,
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
