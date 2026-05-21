import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isProxmoxConfigObject } from "./proxmox-config.mjs";
import { listProxmoxHypervisorSshTargets } from "./proxmox-host-os-maintain.mjs";
import {
  discoverLocalSshMaterial,
  ensureSshAuthorizedKeys,
} from "../../../../tools/hdc/lib/ssh-host-access.mjs";

/**
 * @param {unknown} cfg
 */
export function sshKeysMaintainEnabledFromConfig(cfg) {
  if (!isProxmoxConfigObject(cfg)) return true;
  const provision = cfg.provision;
  if (!isProxmoxConfigObject(provision)) return true;
  const sshKeys = provision.ssh_keys;
  if (!isProxmoxConfigObject(sshKeys)) return true;
  return sshKeys.enabled !== false && sshKeys.enabled !== 0;
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {(line: string) => void} opts.log
 * @param {(line: string) => void} opts.warn
 * @param {import("../../../../tools/hdc/lib/vault-access.mjs").ReturnType<import("../../../../tools/hdc/lib/vault-access.mjs").createVaultAccess>} opts.vault
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {typeof import("node:child_process").spawnSync} opts.spawnSync
 * @param {(q: string, o?: { mask?: boolean }) => Promise<string>} opts.readLineQuestion
 * @param {boolean} [opts.dryRun]
 */
export async function runProxmoxSshKeysMaintain(opts) {
  const { packageRoot, log, warn, vault, env, spawnSync, readLineQuestion, dryRun = false } = opts;
  const configPath = join(packageRoot, "config.json");

  if (!existsSync(configPath)) {
    warn("SSH keys maintain: missing config.json — skip.");
    return { ok: true };
  }

  /** @type {unknown} */
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    warn(`SSH keys maintain: invalid config.json: ${/** @type {Error} */ (e).message}`);
    return { ok: false };
  }

  if (!sshKeysMaintainEnabledFromConfig(cfg)) {
    log("SSH keys maintain: disabled in provision.ssh_keys.enabled — skip.");
    return { ok: true };
  }

  const targets = listProxmoxHypervisorSshTargets(cfg, env);
  if (!targets.length) {
    warn("SSH keys maintain: no clusters[].hosts[] with ssh:// URLs — skip.");
    return { ok: true };
  }

  const { publicKeyLines, identities } = discoverLocalSshMaterial();
  if (!publicKeyLines.length) {
    warn("SSH keys maintain: no public keys in ~/.ssh — add id_ed25519.pub or similar.");
    return { ok: false };
  }

  log(
    `SSH keys maintain: ${targets.length} hypervisor(s); ${publicKeyLines.length} local public key line(s); ${identities.length} private key(s).`,
  );

  let ok = true;
  for (const target of targets) {
    const result = await ensureSshAuthorizedKeys({
      target,
      publicKeyLines,
      identities,
      spawnSync,
      env,
      vault,
      log,
      warn,
      readLineQuestion,
      dryRun,
    });
    if (!result.ok) ok = false;
  }

  if (ok) log("SSH public-key access OK on all hypervisors.");
  else log("One or more hypervisors still lack working SSH public-key auth.");

  return { ok };
}
