#!/usr/bin/env node
/**
 * Maintain Mailcow: refresh stack, reconcile domains/DKIM/relay via API, guest baseline.
 *
 * Usage: hdc run service mailcow maintain -- [--instance a | --system-id vm-mailcow-a]
 *        hdc run service mailcow maintain -- [--skip-upgrade] [--skip-domains] [--skip-cloudflare-dkim] [--skip-clamav]
 */
import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
import { guestBaselineResultFields } from "../../../lib/guest-baseline-report.mjs";
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
import { runOperationReportTail } from "../../../lib/operation-report.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";

import { resolveMailcowDeployments } from "../lib/deployments.mjs";
import { reconcileMailcowDomainsForConfig } from "../lib/mailcow-domains.mjs";
import {
  maintainMailcowStackInCt,
  maintainMailcowStackOnHost,
  resolvePveSshForHost,
} from "../lib/mailcow-install.mjs";
import { createMailcowVaultAccess } from "../lib/vault-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/mailcow/config.example.json";
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
 * @param {ReturnType<typeof resolveMailcowDeployments>[number]} deployment
 * @param {Record<string, string>} flags
 * @param {ReturnType<typeof createMailcowVaultAccess>} vault
 */
async function maintainOne(deployment, flags, vault) {
  const { systemId, mode, proxmox: px, mailcow, install, configure } = deployment;
  const skipUpgrade = flagGet(flags, "skip-upgrade", "skip_upgrade") !== undefined;
  const skipDomains = flagGet(flags, "skip-domains", "skip_domains") !== undefined;
  const skipCloudflareDkim =
    flagGet(flags, "skip-cloudflare-dkim", "skip_cloudflare_dkim") !== undefined;
  const skipBaseline = flagGet(flags, "skip-baseline", "skip_baseline") !== undefined;

  if (!isObject(px)) {
    return { ok: false, system_id: systemId, message: "bad proxmox config" };
  }
  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) {
    return { ok: false, system_id: systemId, message: "missing host_id" };
  }

  const mailcowCfg = isObject(mailcow) ? mailcow : {};
  const installCfg = isObject(install) ? install : {};

  /** @type {{ ok: boolean; message?: string; admin_url?: string; guest_ip?: string | null; ct_ip?: string | null }} */
  let stackResult;

  if (mode === "proxmox-qemu" || mode === "configure-only") {
    const cfg = isObject(configure) ? configure : {};
    const ssh = isObject(cfg.ssh) ? cfg.ssh : {};
    const user = resolveGuestSshUser(ssh.user);
    const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : "";
    if (!host) {
      return { ok: false, system_id: systemId, message: "configure.ssh.host required" };
    }
    const q = isObject(px.qemu) ? px.qemu : {};
    const vmid = typeof q.vmid === "number" ? q.vmid : Number(q.vmid);
    errout.write(`[hdc] ${target} ${verb}: ${systemId} vmid ${vmid} on ${hostId} (QEMU) …\n`);
    const exec = createConfigureExec("ssh", { user, host });
    stackResult = await maintainMailcowStackOnHost(exec, mailcowCfg, installCfg, { skipUpgrade });
  } else {
    const lxc = isObject(px.lxc) ? px.lxc : {};
    const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
    if (!Number.isFinite(vmid) || vmid <= 0) {
      return { ok: false, system_id: systemId, host_id: hostId, message: "invalid vmid" };
    }
    errout.write(`[hdc] ${target} ${verb}: ${systemId} vmid ${vmid} on ${hostId} …\n`);
    const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
    stackResult = await maintainMailcowStackInCt(
      pveSsh.user,
      pveSsh.host,
      vmid,
      mailcowCfg,
      installCfg,
      { skipUpgrade },
    );
  }

  const domainReconcile = await reconcileMailcowDomainsForConfig(mailcowCfg, vault, {
    skipDomains,
    skipCloudflareDkim,
    log: (line) => errout.write(`[hdc] ${target} ${verb}: ${line}\n`),
  });
  const domainResults = domainReconcile.domain_results;
  const dnsChecklists = domainReconcile.dns_checklists;
  const domainsSkipped = domainReconcile.domains_skipped;

  let baseline = { ok: true, skipped: true, message: "skipped" };
  if (!skipBaseline) {
    const log = provisionLogFromConsole(console);
    const vaultAccess = createPackageVaultAccess();
    const baselineFlags = { ...flags, "skip-mail-relay": "" };

    if (mode === "proxmox-qemu" || mode === "configure-only") {
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
        deployment: { systemId, system_id: systemId },
        proxmoxPackageRoot: proxmoxRoot,
      });
    } else {
      const lxc = isObject(px.lxc) ? px.lxc : {};
      const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);
      const pveSsh = resolvePveSshForHost(proxmoxRoot, hostId);
      const exec = createConfigureExec("pct", {
        user: pveSsh.user,
        host: pveSsh.host,
        vmid,
        pveHost: pveSsh.host,
      });
      baseline = await ensureGuestLinuxBaseline({
        exec,
        log,
        flags: baselineFlags,
        vaultAccess,
        deployment: { systemId, system_id: systemId },
        proxmoxPackageRoot: proxmoxRoot,
      });
    }
  }

  const domainsOk = domainsSkipped
    ? true
    : domainReconcile.api_ok === false
      ? false
      : domainResults.every((r) => r.ok !== false);
  const cloudflareDkimOk =
    !domainReconcile.cloudflare_dkim ||
    domainReconcile.cloudflare_dkim.skipped === true ||
    domainReconcile.cloudflare_dkim.ok !== false;
  const vmidRaw =
    mode === "proxmox-qemu" || mode === "configure-only"
      ? isObject(px.qemu)
        ? typeof px.qemu.vmid === "number"
          ? px.qemu.vmid
          : Number(px.qemu.vmid)
        : null
      : isObject(px.lxc)
        ? typeof px.lxc.vmid === "number"
          ? px.lxc.vmid
          : Number(px.lxc.vmid)
        : null;

  return {
    ok: stackResult.ok && domainsOk && cloudflareDkimOk && baseline.ok,
    system_id: systemId,
    host_id: hostId,
    mode,
    vmid: Number.isFinite(vmidRaw) ? vmidRaw : null,
    skip_upgrade: skipUpgrade,
    skip_domains: skipDomains,
    skip_cloudflare_dkim: skipCloudflareDkim,
    domains_skipped: domainsSkipped,
    configured_domain_count: domainReconcile.configured_domain_count,
    api_ok: domainReconcile.api_ok,
    api_error: domainReconcile.api_error,
    reconcile_summary: domainReconcile.reconcile_summary,
    cloudflare_dkim: domainReconcile.cloudflare_dkim,
    domain_results: domainResults,
    dns_checklists: dnsChecklists,
    admin_url: stackResult.admin_url ?? null,
    guest_ip: stackResult.guest_ip ?? stackResult.ct_ip ?? null,
    ct_ip: stackResult.ct_ip ?? stackResult.guest_ip ?? null,
    message: stackResult.message,
    ...guestBaselineResultFields(baseline),
  };
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: refresh Mailcow stack (stderr log; JSON on stdout).\n`);

  if (!existsSync(ensurePackageConfig().path)) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing — see stderr" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const cfg = readCfg();
  const flags = parseArgvFlags(process.argv.slice(2));
  let deployments;
  try {
    deployments = resolveMailcowDeployments(cfg, flags);
  } catch (e) {
    errout.write(`[hdc] ${target} ${verb}: ${/** @type {Error} */ (e).message}\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const vault = createMailcowVaultAccess();
  const results = [];
  for (const deployment of deployments) {
    try {
      results.push(await maintainOne(deployment, flags, vault));
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      errout.write(`[hdc] ${target} ${verb}: ${deployment.systemId} failed: ${msg}\n`);
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
