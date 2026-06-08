#!/usr/bin/env node
import { guestBaselineResultFields } from "../../../lib/guest-baseline-report.mjs";
/**
 * Maintain RustFS cluster: re-push docker-compose.yml + .env, refresh Docker images, guest baseline.
 *
 * Usage: hdc run service rustfs maintain -- [--instance a|b|c|d]
 *        hdc run service rustfs maintain -- [--skip-upgrade] [--skip-clamav]
 */
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { createConfigureExec } from "../../postfix-relay/lib/postfix-relay-configure.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import {
  clusterPeersFromDeployments,
  normalizeRustfsConfig,
  resolveRustfsDeployments,
  rustfsGlobalSettings,
} from "../lib/deployments.mjs";
import { maintainRustfsInCt, resolvePveSshForHost } from "../lib/rustfs-install.mjs";
import { createRustfsVaultAccess } from "../lib/vault-deps.mjs";
import { resolveRustfsCredentials } from "../lib/vault-secrets.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/rustfs/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let _pkgConfig = null;
function ensurePackageConfig() {
  if (!_pkgConfig) {
    _pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  }
  return _pkgConfig;
}

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
 * @param {ReturnType<typeof resolveRustfsDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {import("../../../lib/package-vault-access.mjs").PackageVaultAccess} vaultAccess
 * @param {{ peers: { hostname: string }[]; accessKey: string; secretKey: string }} clusterCtx
 */
async function maintainOne(deployment, flags, vaultAccess, clusterCtx) {
  const { systemId, proxmox: px, rustfs, install } = deployment;
  const skipUpgrade = flagGet(flags, "skip-upgrade", "skip_upgrade") !== undefined;

  if (!isObject(px)) {
    return { ok: false, system_id: systemId, message: "bad proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) {
    return { ok: false, system_id: systemId, message: "missing host_id" };
  }

  const lxc = isObject(px.lxc) ? px.lxc : {};
  const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
  if (!Number.isFinite(vmid) || vmid <= 0) {
    return { ok: false, system_id: systemId, host_id: hostId, message: "invalid vmid" };
  }

  errout.write(`[hdc] ${target} ${verb}: ${systemId} vmid ${vmid} on ${hostId} …\n`);
  const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
  const rustfsCfg = isObject(rustfs) ? rustfs : {};
  const installCfg = isObject(install) ? install : {};

  const result = await maintainRustfsInCt(pveSsh.user, pveSsh.host, vmid, rustfsCfg, installCfg, {
    peers: clusterCtx.peers,
    accessKey: clusterCtx.accessKey,
    secretKey: clusterCtx.secretKey,
    skipUpgrade,
  });

  const log = provisionLogFromConsole(console);
  const exec = createConfigureExec("pct", {
    user: pveSsh.user,
    host: pveSsh.host,
    vmid,
    pveHost: pveSsh.host,
  });
  const baseline = await ensureGuestLinuxBaseline({
    exec,
    log,
    flags,
    vaultAccess,
    deployment,
    proxmoxPackageRoot: proxmoxRoot,
  });

  return {
    ok: result.ok && baseline.ok,
    system_id: systemId,
    host_id: hostId,
    vmid,
    skip_upgrade: skipUpgrade,
    s3_url: result.s3_url ?? null,
    console_url: result.console_url ?? null,
    upstream_s3: result.upstream_s3 ?? null,
    upstream_console: result.upstream_console ?? null,
    message: result.message,
    ...guestBaselineResultFields(baseline),
  };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: refresh RustFS Docker stack (stderr log; JSON on stdout).\n`);

  if (!existsSync(ensurePackageConfig().path)) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing — see stderr" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});

  const normalized = normalizeRustfsConfig(cfg);
  const peers = clusterPeersFromDeployments(normalized.deployments, normalized.rustfs);

  let deployments;
  try {
    deployments = resolveRustfsDeployments(cfg, flags);
  } catch (e) {
    errout.write(`[hdc] ${target} ${verb}: ${/** @type {Error} */ (e).message}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const rustfsVault = createRustfsVaultAccess();
  const global = rustfsGlobalSettings(normalized, deployments);
  const creds = await resolveRustfsCredentials(rustfsVault, {
    accessKeyVaultKey: global.accessKeyVaultKey,
    secretKeyVaultKey: global.secretKeyVaultKey,
  });

  const results = [];
  for (const deployment of deployments) {
    try {
      results.push(
        await maintainOne(deployment, flags, vaultAccess, {
          peers,
          accessKey: creds.accessKey,
          secretKey: creds.secretKey,
        }),
      );
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
      results.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }

  const ok = results.every((r) => r.ok);
  const payload = { ok, target, verb, cluster_nodes: peers.length, count: results.length, results };
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
