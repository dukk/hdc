#!/usr/bin/env node
/**
 * Fast admin-password rollout: ensureAdminUser on every Proxmox guest deployment.
 * Usage: node apps/hdc-cli/scripts/rollout-admin-password.mjs [--dry-run]
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ensureAdminUser } from "hdc/package/admin-user-ensure.mjs";
import { createConfigureExec } from "hdc/clump/services/postfix-relay/lib/postfix-relay-configure.mjs";
import { resolveGuestSshUser } from "hdc/package/guest-ssh-resolve.mjs";
import { createPackageVaultAccess } from "hdc/package/package-vault-access.mjs";
import { provisionLogFromConsole } from "hdc/package/host-provisioner.mjs";
import { resolvePveSshForHost } from "hdc/clump/services/ollama/lib/ollama-install.mjs";
import { loadDotenv } from "../env.mjs";
import { hdcPrivateRoot } from "../lib/private-repo.mjs";
import { loadClumpConfigFromClumpRoot } from "../lib/clump-config.mjs";
import { repoRoot } from "../paths.mjs";

const dryRun = process.argv.includes("--dry-run");
const root = repoRoot();
loadDotenv(join(root, ".env"));
const privateRoot = hdcPrivateRoot(root);
const servicesRoot = join(privateRoot, "clumps", "services");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} cfg
 * @returns {Record<string, unknown>[]}
 */
function deploymentsFromConfig(cfg) {
  if (!Array.isArray(cfg.deployments)) return [];
  return cfg.deployments.filter(isObject).map((d) => /** @type {Record<string, unknown>} */ (d));
}

/**
 * @param {Record<string, unknown>} deployment
 * @returns {import("hdc/package/clamav-ensure.mjs").ConfigureExec | null}
 */
function resolveExecForDeployment(deployment) {
  const mode = typeof deployment.mode === "string" ? deployment.mode.trim() : "";
  if (mode === "synology-docker" || mode === "synology-package") return null;

  const configure = isObject(deployment.configure) ? deployment.configure : {};
  const ssh = isObject(configure.ssh) ? configure.ssh : {};
  const sshHost = typeof ssh.host === "string" ? ssh.host.trim().split("/")[0] : "";
  if (sshHost) {
    return createConfigureExec("ssh", {
      user: resolveGuestSshUser(ssh.user),
      host: sshHost,
    });
  }

  const px = isObject(deployment.proxmox) ? deployment.proxmox : null;
  if (!px) return null;

  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  const proxmoxHostId = hostId.replace(/^hypervisor-/, "pve-");
  const lxc = isObject(px.lxc) ? px.lxc : null;
  const lxcVmid =
    lxc && (typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid));
  if (hostId && Number.isFinite(lxcVmid) && lxcVmid > 0) {
    const pveSsh = resolvePveSshForHost(
      join(root, "clumps", "infrastructure", "proxmox"),
      proxmoxHostId,
    );
    return createConfigureExec("pct", {
      user: pveSsh.user,
      host: pveSsh.host,
      vmid: lxcVmid,
      pveHost: pveSsh.host,
    });
  }

  const qemu = isObject(px.qemu) ? px.qemu : null;
  const qemuIp =
    qemu && typeof qemu.ip === "string" ? qemu.ip.trim().split("/")[0] : "";
  if (qemuIp) {
    return createConfigureExec("ssh", {
      user: resolveGuestSshUser(ssh.user),
      host: qemuIp,
    });
  }

  return null;
}

/** @type {string[]} */
const clumpIds = readdirSync(servicesRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

async function main() {
  const vaultAccess = createPackageVaultAccess();
  if (!dryRun) {
    await vaultAccess.unlock({});
  }

  const log = provisionLogFromConsole(console);
  /** @type {{ package: string; system_id: string; ok: boolean; skipped?: boolean; message: string }[]} */
  const results = [];

  for (const pkg of clumpIds) {
    const cfgPath = join(servicesRoot, pkg, "config.json");
    if (!existsSync(cfgPath)) continue;

    /** @type {Record<string, unknown> | null} */
    let cfg = null;
    try {
      const clumpRoot = join(root, "clumps", "services", pkg);
      const loaded = loadClumpConfigFromClumpRoot(clumpRoot, { publicRoot: root });
      cfg = loaded.data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        package: pkg,
        system_id: "*",
        ok: false,
        message: `config load failed: ${msg}`,
      });
      continue;
    }
    if (!cfg || !isObject(cfg)) continue;

    const deployments = deploymentsFromConfig(cfg);
    if (deployments.length === 0) {
      results.push({
        package: pkg,
        system_id: "*",
        ok: true,
        skipped: true,
        message: "no deployments",
      });
      continue;
    }

    for (const deployment of deployments) {
      const systemId =
        typeof deployment.system_id === "string" && deployment.system_id.trim()
          ? deployment.system_id.trim()
          : `${pkg}-unknown`;

      let exec;
      try {
        exec = resolveExecForDeployment(deployment);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ package: pkg, system_id: systemId, ok: false, message: msg });
        continue;
      }

      if (!exec) {
        results.push({
          package: pkg,
          system_id: systemId,
          ok: true,
          skipped: true,
          message: "no SSH/LXC target",
        });
        continue;
      }

      process.stderr.write(
        `[rollout] ${pkg}/${systemId}: admin user via ${exec.label} …\n`,
      );

      if (dryRun) {
        results.push({
          package: pkg,
          system_id: systemId,
          ok: true,
          skipped: true,
          message: "dry-run",
        });
        continue;
      }

      const admin = await ensureAdminUser({ exec, log, vaultAccess });
      results.push({
        package: pkg,
        system_id: systemId,
        ok: admin.ok,
        message: admin.message,
      });
    }
  }

  const failed = results.filter((r) => !r.ok && !r.skipped);
  const ok = results.filter((r) => r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  process.stderr.write(
    `\n[rollout] done: ${ok.length} updated, ${failed.length} failed, ${skipped.length} skipped\n`,
  );
  for (const r of failed) {
    process.stderr.write(
      `[rollout] FAILED ${r.package}/${r.system_id}: ${r.message}\n`,
    );
  }

  process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, results }, null, 2)}\n`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
