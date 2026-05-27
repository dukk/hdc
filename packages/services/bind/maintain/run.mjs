#!/usr/bin/env node
/**
 * Re-sync BIND zone files on primary, named options on all nodes, verify SOA on secondary.
 *
 * Usage: hdc run service bind maintain -- [--skip-clamav] [--skip-guest-agent]
 */
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  bindGlobalSettings,
  normalizeBindConfig,
  resolveBindDeployments,
} from "../lib/deployments.mjs";
import { createConfigureExec, syncNamedOptions, syncPrimaryZoneFiles } from "../lib/bind-configure.mjs";
import { syncDnscryptProxyOdoh } from "../lib/bind-dnscrypt-configure.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { waitForSoaSerialMatch } from "../lib/bind-query-remote.mjs";
import { bindReportExtraSections } from "../lib/bind-report.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";
import { soaSerialFromTimestamp } from "../lib/bind-zones.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { ensureQemuGuestAgentForDeploymentMaintain } from "../../../infrastructure/proxmox/lib/proxmox-qemu-guest-agent-for-deployment.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/bind/config.example.json";
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

/**
 * @param {ReturnType<typeof resolveBindDeployments>[number]} deployment
 * @param {string} defaultHost
 */
function sshTarget(deployment, defaultHost) {
  const ssh = isObject(deployment.configure) && isObject(deployment.configure.ssh)
    ? deployment.configure.ssh
    : {};
  const user = typeof ssh.user === "string" && ssh.user.trim() ? ssh.user.trim() : "root";
  const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : defaultHost;
  return { user, host };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: BIND zone sync and SOA check (stderr log; JSON on stdout).\n`);

  const cfg = ensurePackageConfig().data;
  const flags = parseArgvFlags(process.argv.slice(2));
  const vaultAccess = createPackageVaultAccess();
  await vaultAccess.unlock({});
  const normalized = normalizeBindConfig(cfg);
  const global = bindGlobalSettings(normalized);
  const deployments = resolveBindDeployments(cfg, flags);
  const primary = deployments.find((d) => d.role === "primary");
  const secondary = deployments.find((d) => d.role === "secondary");

  const log = provisionLogFromConsole(console);
  const serial = soaSerialFromTimestamp();
  errout.write(`[hdc] ${target} ${verb}: SOA serial ${serial} (UTC timestamp)\n`);

  const skipGuestAgent = flagGet(flags, "skip-guest-agent") !== undefined;

  /** @type {Record<string, unknown>[]} */
  const results = [];

  if (!skipGuestAgent) {
    for (const deployment of deployments) {
      if (deployment.mode !== "proxmox-qemu") continue;
      const defaultHost =
        deployment.role === "primary" ? global.primaryIp : global.secondaryIp;
      errout.write(`[hdc] ${target} ${verb}: qemu-guest-agent on ${deployment.systemId} …\n`);
      const guestAgent = await ensureQemuGuestAgentForDeploymentMaintain({
        proxmoxPackageRoot: proxmoxRoot,
        deployment,
        defaultSshHost: defaultHost,
        log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
      });
      const existing = results.find((r) => r.system_id === deployment.systemId);
      if (existing) {
        existing.guest_agent = guestAgent;
        if (!guestAgent.ok) existing.ok = false;
      } else {
        results.push({
          ok: guestAgent.ok !== false,
          system_id: deployment.systemId,
          role: deployment.role,
          guest_agent: guestAgent,
        });
      }
    }
  }

  for (const deployment of deployments) {
    const defaultHost = deployment.role === "primary" ? global.primaryIp : global.secondaryIp;
    const { user, host } = sshTarget(deployment, defaultHost);
    errout.write(`[hdc] ${target} ${verb}: syncing upstream and named options on ${user}@${host} …\n`);
    try {
      const exec = createConfigureExec("ssh", { user, host });
      let dnscrypt = null;
      if (global.forwardUpstream.mode === "odoh") {
        dnscrypt = syncDnscryptProxyOdoh({
          exec,
          log,
          forwardUpstream: global.forwardUpstream,
        });
      }
      const options = syncNamedOptions({
        exec,
        log,
        allowQueryCidrs: global.allowQueryCidrs,
        recursion: global.recursion,
        dnssecValidation: global.dnssecValidation,
        forwarders: global.forwarders,
      });
      results.push({
        ok: true,
        system_id: deployment.systemId,
        role: deployment.role,
        ...(dnscrypt ? { dnscrypt_proxy: dnscrypt } : {}),
        options,
      });
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} options sync failed: ${msg}\n`);
      results.push({ ok: false, system_id: deployment.systemId, role: deployment.role, message: msg });
    }
  }

  if (primary) {
    const { user, host } = sshTarget(primary, global.primaryIp);
    errout.write(`[hdc] ${target} ${verb}: syncing zones on primary ${user}@${host} …\n`);
    try {
      const exec = createConfigureExec("ssh", { user, host });
      const zoneSync = syncPrimaryZoneFiles({
        exec,
        log,
        zoneIds: global.zoneIds,
        zoneDefinitions: global.zoneDefinitions,
        primaryIp: global.primaryIp,
        secondaryIp: global.secondaryIp,
        hostmaster: global.hostmaster,
        serial,
      });
      const row = results.find((r) => r.system_id === primary.systemId);
      if (row) {
        row.zone_sync = zoneSync.details;
      } else {
        results.push({
          ok: true,
          system_id: primary.systemId,
          role: "primary",
          zone_sync: zoneSync.details,
        });
      }
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: primary zone sync failed: ${msg}\n`);
      results.push({ ok: false, system_id: primary.systemId, role: "primary", message: msg });
    }
  }

  if (primary && secondary && global.zoneIds.length) {
    const zone = global.zoneIds[0];
    const { user: pUser, host: pHost } = sshTarget(primary, global.primaryIp);
    const { user: sUser, host: sHost } = sshTarget(secondary, global.secondaryIp);
    errout.write(`[hdc] ${target} ${verb}: verifying SOA serial for ${zone} …\n`);
    const soaCheck = await waitForSoaSerialMatch({
      zone,
      primaryUser: pUser,
      primaryHost: pHost,
      secondaryUser: sUser,
      secondaryHost: sHost,
      log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    });
    results.push({
      ...soaCheck,
      system_id: secondary.systemId,
      role: "secondary",
    });
  }

  for (const deployment of deployments) {
    const defaultHost = deployment.role === "primary" ? global.primaryIp : global.secondaryIp;
    const { user, host } = sshTarget(deployment, defaultHost);
    try {
      const exec = createConfigureExec("ssh", { user, host });
      await ensureGuestLinuxBaseline({ exec, log, flags, vaultAccess });
    } catch (e) {
      errout.write(
        `[hdc] ${target} ${verb}: baseline on ${deployment.systemId}: ${String(/** @type {Error} */ (e).message || e)}\n`,
      );
    }
  }

  const ok = results.every((r) => r.ok !== false);
  const payload = { ok, target, verb, count: results.length, results };
  runOperationReportTail({
    packageRoot,
    repoRoot: root,
    verb,
    argv: process.argv.slice(2),
    payload,
    ok,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
    extraSections: bindReportExtraSections,
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
