#!/usr/bin/env node
/**
 * Re-apply Postfix relay configuration from packages/services/postfix-relay/config.json.
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout, env } from "node:process";

import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { createPostfixRelayVaultAccess } from "../lib/vault-deps.mjs";
import { configurePostfixRelay, createConfigureExec } from "../lib/postfix-relay-configure.mjs";
import { parseSshUrl } from "../../../../tools/hdc/lib/users-bootstrap-hdc.mjs";
import { resolveProxmoxHost } from "../../../infrastructure/proxmox/lib/proxmox-config.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const cfgPath = join(here, "..", "config.json");
const proxmoxRoot = join(repoRoot(), "packages", "infrastructure", "proxmox");

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} cfg
 */
function resolveConfigureTarget(cfg) {
  const configure = isObject(cfg.configure) ? cfg.configure : {};
  const via = typeof configure.via === "string" ? configure.via.trim().toLowerCase() : "pct";
  const px = isObject(cfg.proxmox) ? cfg.proxmox : {};
  const lxc = isObject(px.lxc) ? px.lxc : {};
  const vmid = typeof lxc.vmid === "number" ? lxc.vmid : Number(lxc.vmid);

  if (via === "ssh") {
    const ssh = isObject(configure.ssh) ? configure.ssh : {};
    const user = typeof ssh.user === "string" && ssh.user.trim() ? ssh.user.trim() : "root";
    const host = typeof ssh.host === "string" && ssh.host.trim() ? ssh.host.trim() : "";
    if (!host) throw new Error("configure.ssh.host required");
    return createConfigureExec("ssh", { user, host });
  }

  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  const pveCfg = JSON.parse(readFileSync(join(proxmoxRoot, "config.json"), "utf8"));
  const hostRec = resolveProxmoxHost(pveCfg, hostId);
  const parsed = parseSshUrl(hostRec?.ssh ?? "");
  const user =
    parsed?.user ||
    (typeof env.HDC_PROXMOX_SSH_USER === "string" ? env.HDC_PROXMOX_SSH_USER.trim() : "root");
  if (!parsed?.host || !Number.isFinite(vmid) || vmid <= 0) {
    throw new Error("pct maintain needs proxmox.host_id, host ssh URL, and proxmox.lxc.vmid");
  }
  return createConfigureExec("pct", { user, host: parsed.host, vmid, pveHost: parsed.host });
}

async function main() {
  errout.write(`[hdc] ${target} ${verb}: re-apply Postfix relay config from config.json.\n`);
  if (!existsSync(cfgPath)) {
    errout.write(`[hdc] ${target} ${verb}: missing config.json — copy config.example.json\n`);
    process.exitCode = 1;
    return;
  }
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const vault = createPostfixRelayVaultAccess();
  await vault.unlock({});

  const smtp = isObject(cfg.smtp) ? cfg.smtp : {};
  const postfix = isObject(cfg.postfix) ? cfg.postfix : {};
  const userKey =
    (typeof smtp.auth_user_vault_key === "string" && smtp.auth_user_vault_key.trim()) ||
    "HDC_POSTFIX_RELAY_SMTP_USER";
  const passKey =
    (typeof smtp.auth_pass_vault_key === "string" && smtp.auth_pass_vault_key.trim()) ||
    "HDC_POSTFIX_RELAY_SMTP_PASSWORD";
  const smtpUser = String(await vault.getSecret(userKey, { promptLabel: userKey })).trim();
  const smtpPass = String(await vault.getSecret(passKey, { promptLabel: passKey })).trim();

  const exec = resolveConfigureTarget(cfg);
  const log = provisionLogFromConsole(console);
  try {
    configurePostfixRelay({ exec, log, postfix, smtp, smtpUser, smtpPass });
    errout.write(`[hdc] ${target} ${verb}: ok.\n`);
  } catch (e) {
    errout.write(`[hdc] ${target} ${verb}: failed: ${/** @type {Error} */ (e).message || e}\n`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.exitCode = 1;
});
