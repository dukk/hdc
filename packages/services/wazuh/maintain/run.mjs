#!/usr/bin/env node
/**
 * Maintain Wazuh: refresh docker stack and guest baseline.
 *
 * Usage: hdc run service wazuh maintain -- [--instance a | --system-id vm-wazuh-a] [--skip-upgrade] [--skip-clamav]
 */
import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { ensureGuestLinuxBaseline } from "../../../lib/guest-linux-baseline.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import { createConfigureExec } from "../../postfix-relay/lib/postfix-relay-configure.mjs";
import { guestBaselineResultFields } from "../../../lib/guest-baseline-report.mjs";
import { resolveWazuhDeployments, wazuhApiPasswordVaultKey, wazuhAgentPasswordVaultKey } from "../lib/deployments.mjs";
import { maintainWazuhInCt, maintainWazuhOnHost, resolvePveSshForHost } from "../lib/wazuh-install.mjs";
import { createWazuhVaultAccess } from "../lib/vault-deps.mjs";
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/wazuh/config.example.json";
/** @type {{ data: Record<string, unknown>; path: string; source: string } | null} */
let pkgConfig = null;
function ensurePackageConfig() {
  if (!pkgConfig) pkgConfig = loadPackageConfigFromPackageRoot(packageRoot, { exampleRel: PACKAGE_CONFIG_EXAMPLE });
  return pkgConfig;
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
 * @param {ReturnType<typeof resolveWazuhDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {ReturnType<typeof createWazuhVaultAccess>} vaultAccess
 * @param {{ apiPassword: string; agentPassword: string }} passwords
 */
async function maintainOne(deployment, flags, vaultAccess, passwords) {
  const { systemId, mode, proxmox: px, wazuh, install, configure } = deployment;
  if (!isObject(px)) return { ok: false, system_id: systemId, message: "bad proxmox config" };
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) return { ok: false, system_id: systemId, message: "missing host_id" };

  const skipUpgrade = flagGet(flags, "skip-upgrade", "skip_upgrade") !== undefined;
  const wazuhCfg = isObject(wazuh) ? wazuh : {};
  const installCfg = isObject(install) ? install : {};

  /** @type {{ ok: boolean; message?: string }} */
  let result;

  if (mode === "proxmox-qemu") {
    const cfg = isObject(configure) ? configure : {};
    const ssh = isObject(cfg.ssh) ? cfg.ssh : {};
    const user = resolveGuestSshUser(ssh.user);
    const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : "";
    if (!host) return { ok: false, system_id: systemId, message: "configure.ssh.host required" };
    const q = isObject(px.qemu) ? px.qemu : {};
    const vmid = typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
    errout.write(`[hdc] ${target} ${verb}: ${systemId} vmid ${vmid} on ${hostId} (QEMU) …\n`);
    const exec = createConfigureExec("ssh", { user, host });
    result = await maintainWazuhOnHost(exec, wazuhCfg, installCfg, passwords.apiPassword, passwords.agentPassword, {
      skipUpgrade,
    });
  } else {
    const lxc = isObject(px.lxc) ? px.lxc : {};
    const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
    if (!Number.isFinite(vmid) || vmid <= 0) return { ok: false, system_id: systemId, message: "missing vmid" };
    const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
    result = await maintainWazuhInCt(
      pveSsh.user,
      pveSsh.host,
      vmid,
      wazuhCfg,
      installCfg,
      passwords.apiPassword,
      passwords.agentPassword,
      { skipUpgrade },
    );
  }

  const log = provisionLogFromConsole(console);
  const baselineFlags = { ...flags, "skip-wazuh-agent": "1", "skip-crowdsec-agent": "1" };

  let baseline;
  if (mode === "proxmox-qemu") {
    const cfg = isObject(configure) ? configure : {};
    const ssh = isObject(cfg.ssh) ? cfg.ssh : {};
    const user = resolveGuestSshUser(ssh.user);
    const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : "";
    const exec = createConfigureExec("ssh", { user, host });
    baseline = await ensureGuestLinuxBaseline({
      exec,
      log,
      flags: baselineFlags,
      vaultAccess,
      deployment,
      proxmoxPackageRoot: proxmoxRoot,
    });
  } else {
    const lxc = isObject(px.lxc) ? px.lxc : {};
    const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
    const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
    const exec = createConfigureExec("pct", { user: pveSsh.user, host: pveSsh.host, vmid, pveHost: pveSsh.host });
    baseline = await ensureGuestLinuxBaseline({
      exec,
      log,
      flags: baselineFlags,
      vaultAccess,
      deployment,
      proxmoxPackageRoot: proxmoxRoot,
    });
  }

  const vmidRaw =
    mode === "proxmox-qemu"
      ? (() => {
          const q = isObject(px.qemu) ? px.qemu : {};
          return typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
        })()
      : (() => {
          const lxc = isObject(px.lxc) ? px.lxc : {};
          return typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
        })();

  return {
    ok: result.ok && baseline.ok,
    system_id: systemId,
    host_id: hostId,
    mode,
    vmid: vmidRaw,
    ...result,
    ...guestBaselineResultFields(baseline),
  };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: refresh Wazuh stack (stderr log; JSON on stdout).\n`);
  if (!existsSync(ensurePackageConfig().path)) {
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: "package config missing - see stderr" }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  let deployments;
  try {
    deployments = resolveWazuhDeployments(cfg, flags);
  } catch (e) {
    const message = String(/** @type {Error} */ (e).message || e);
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const defaultsWazuh = isObject(cfg.defaults) && isObject(cfg.defaults.wazuh) ? cfg.defaults.wazuh : {};
  const apiKeyName = wazuhApiPasswordVaultKey(defaultsWazuh);
  const agentKeyName = wazuhAgentPasswordVaultKey(defaultsWazuh);
  const vaultAccess = createWazuhVaultAccess();
  await vaultAccess.unlock({});
  const apiPassword = String(await vaultAccess.getSecret(apiKeyName, { promptLabel: `vault secret ${apiKeyName}` })).trim();
  const agentPassword = String(await vaultAccess.getSecret(agentKeyName, { promptLabel: `vault secret ${agentKeyName}` })).trim();
  if (!apiPassword || !agentPassword) {
    process.stdout.write(`${JSON.stringify({ ok: false, target, verb, message: "missing wazuh vault secrets" }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const deployment of deployments) {
    try {
      results.push(await maintainOne(deployment, flags, vaultAccess, { apiPassword, agentPassword }));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      results.push({ ok: false, system_id: deployment.systemId, message: msg });
    }
  }
  const ok = results.every((r) => r.ok);
  const payload = { ok, target, verb, count: results.length, results };
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
