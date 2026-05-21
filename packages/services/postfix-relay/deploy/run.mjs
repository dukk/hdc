#!/usr/bin/env node
/**
 * Deploy Postfix as an outbound SMTP relay on Proxmox (LXC) or an existing SSH host.
 *
 * Provisions an LXC when deploy.mode is proxmox-lxc (unless deploy.skip_provision).
 * Configures relayhost + SASL using vault keys from config (see config.example.json).
 */
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stderr as errout, env } from "node:process";

import { deployTargetInventory, logDeployInventoryStatus } from "../../../lib/deploy-inventory.mjs";
import { provisionLogFromConsole } from "../../../lib/host-provisioner.mjs";
import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { createPostfixRelayVaultAccess } from "../lib/vault-deps.mjs";
import { parseSshUrl } from "../../../../tools/hdc/lib/users-bootstrap-hdc.mjs";
import { authorizeProxmoxForHost } from "../../../infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import { createProxmoxHostProvisioner } from "../../../infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";
import { resolveProxmoxHost } from "../../../infrastructure/proxmox/lib/proxmox-config.mjs";
import { configurePostfixRelay, createConfigureExec } from "../lib/postfix-relay-configure.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();
const cfgPath = join(here, "..", "config.json");
const proxmoxRoot = join(root, "packages", "infrastructure", "proxmox");

const inv = deployTargetInventory(root, target);
logDeployInventoryStatus(target, verb, inv);

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readCfg() {
  if (!existsSync(cfgPath)) {
    throw new Error(`Missing ${cfgPath} — copy packages/services/postfix-relay/config.example.json`);
  }
  return JSON.parse(readFileSync(cfgPath, "utf8"));
}

/**
 * @param {Record<string, unknown>} smtp
 * @param {ReturnType<typeof createVaultAccess>} vault
 */
async function resolveSmtpCredentials(smtp, vault) {
  const userKey =
    (typeof smtp.auth_user_vault_key === "string" && smtp.auth_user_vault_key.trim()) ||
    "HDC_POSTFIX_RELAY_SMTP_USER";
  const passKey =
    (typeof smtp.auth_pass_vault_key === "string" && smtp.auth_pass_vault_key.trim()) ||
    "HDC_POSTFIX_RELAY_SMTP_PASSWORD";
  const userEnv =
    typeof smtp.auth_user_env === "string" && smtp.auth_user_env.trim() ? smtp.auth_user_env.trim() : userKey;

  let user = String(env[userEnv] ?? "").trim();
  if (!user) {
    const fromVault = await vault.getSecret(userKey, { promptLabel: `vault secret ${userKey}` });
    user = String(fromVault ?? "").trim();
  }
  const pass = String(
    await vault.getSecret(passKey, { promptLabel: `vault secret ${passKey}` }),
  ).trim();
  if (!user || !pass) {
    throw new Error(
      `SMTP credentials missing — set ${userEnv} or vault ${userKey}, and vault ${passKey} (hdc secrets set)`,
    );
  }
  errout.write(`[hdc] ${target} ${verb}: SMTP user from ${user ? (env[userEnv] ? `env ${userEnv}` : `vault ${userKey}`) : "?"}\n`);
  return { user, pass };
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
    if (!host) throw new Error("configure.via ssh requires configure.ssh.host");
    return { via: "ssh", exec: createConfigureExec("ssh", { user, host }) };
  }

  const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
  if (!hostId) throw new Error("configure.via pct requires proxmox.host_id");
  const pveCfgPath = join(proxmoxRoot, "config.json");
  if (!existsSync(pveCfgPath)) {
    throw new Error("Missing packages/infrastructure/proxmox/config.json for pct access");
  }
  const pveCfg = JSON.parse(readFileSync(pveCfgPath, "utf8"));
  const hostRec = resolveProxmoxHost(pveCfg, hostId);
  if (!hostRec?.ssh) {
    throw new Error(`Proxmox host ${JSON.stringify(hostId)} has no ssh:// URL in proxmox config`);
  }
  const parsed = parseSshUrl(hostRec.ssh);
  if (!parsed?.host) {
    throw new Error(`Invalid ssh URL for Proxmox host ${JSON.stringify(hostId)}`);
  }
  const user =
    parsed.user ||
    (typeof env.HDC_PROXMOX_SSH_USER === "string" && env.HDC_PROXMOX_SSH_USER.trim()
      ? env.HDC_PROXMOX_SSH_USER.trim()
      : "root");
  if (!Number.isFinite(vmid) || vmid <= 0) {
    throw new Error("configure.via pct requires proxmox.lxc.vmid");
  }
  return {
    via: "pct",
    exec: createConfigureExec("pct", { user, host: parsed.host, vmid, pveHost: parsed.host }),
  };
}

async function main() {
  errout.write(
    `[hdc] ${target} ${verb}: Postfix SMTP relay (Proxmox LXC + configure; stderr log; JSON on stdout).\n`,
  );
  if (!inv.ready) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "package config missing — see stderr" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const cfg = readCfg();
  const deploy = isObject(cfg.deploy) ? cfg.deploy : {};
  const mode = typeof deploy.mode === "string" ? deploy.mode.trim() : "";
  const skipProvision = deploy.skip_provision === true;
  const log = provisionLogFromConsole(console);
  const vault = createPostfixRelayVaultAccess();

  /** @type {import("../../../lib/host-provisioner.mjs").ProvisionResult | null} */
  let provisionResult = null;

  if (mode === "proxmox-lxc" && !skipProvision) {
    const px = isObject(cfg.proxmox) ? cfg.proxmox : {};
    const hostId = typeof px.host_id === "string" ? px.host_id.trim() : "";
    if (!hostId) {
      errout.write(`[hdc] ${target} ${verb}: proxmox.host_id required for proxmox-lxc\n`);
      process.stdout.write(
        `${JSON.stringify({ ok: false, target, verb, message: "missing host_id" }, null, 2)}\n`,
      );
      process.exitCode = 1;
      return;
    }
    const lxc = isObject(px.lxc) ? px.lxc : {};
    const hostname =
      (typeof lxc.hostname === "string" && lxc.hostname.trim()) ||
      inv.systemId.replace(/^ct-/, "").slice(0, 63) ||
      "postfix-relay";
    const memoryMb = typeof lxc.memory_mb === "number" ? lxc.memory_mb : Number(lxc.memory_mb);
    const cores = typeof lxc.cores === "number" ? lxc.cores : Number(lxc.cores);
    const diskGb = typeof lxc.rootfs_gb === "number" ? lxc.rootfs_gb : Number(lxc.rootfs_gb);
    if (![memoryMb, cores, diskGb].every((n) => Number.isFinite(n) && n > 0)) {
      errout.write(`[hdc] ${target} ${verb}: proxmox.lxc needs numeric memory_mb, cores, rootfs_gb\n`);
      process.stdout.write(
        `${JSON.stringify({ ok: false, target, verb, message: "invalid lxc sizing" }, null, 2)}\n`,
      );
      process.exitCode = 1;
      return;
    }

    errout.write(
      `[hdc] ${target} ${verb}: provisioning LXC on ${JSON.stringify(hostId)} (vmid ${lxc.vmid ?? "?"}) …\n`,
    );
    const auth = await authorizeProxmoxForHost({ packageRoot: proxmoxRoot, hostId, vault });
    const prov = createProxmoxHostProvisioner({
      apiBase: auth.host.apiBase,
      pveNode: auth.host.pveNode,
      authorization: auth.authorization,
      rejectUnauthorized: auth.rejectUnauthorized,
    });
  /** @type {Record<string, unknown>} */
    const parameters = { ...lxc };
    provisionResult = await prov.createContainer(log, {
      name: hostname,
      memoryMb,
      cores,
      diskGb,
      parameters,
    });
    if (!provisionResult.ok) {
      process.stdout.write(
        `${JSON.stringify(
          { ok: false, target, verb, mode, system_id: inv.systemId, provision: provisionResult },
          null,
          2,
        )}\n`,
      );
      process.exitCode = 1;
      return;
    }
    errout.write(
      `[hdc] ${target} ${verb}: LXC create accepted — wait for the guest to boot, then Postfix will be configured.\n`,
    );
  } else if (mode === "configure-only") {
    errout.write(`[hdc] ${target} ${verb}: configure-only (no Proxmox provision).\n`);
  } else if (mode !== "proxmox-lxc") {
    errout.write(`[hdc] ${target} ${verb}: set deploy.mode to proxmox-lxc or configure-only\n`);
    process.stdout.write(
      `${JSON.stringify({ ok: false, target, verb, message: "unknown deploy.mode" }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  } else {
    errout.write(`[hdc] ${target} ${verb}: skip_provision — configuring existing guest only.\n`);
  }

  errout.write(`[hdc] ${target} ${verb}: loading SMTP credentials from vault …\n`);
  await vault.unlock({});
  const smtp = isObject(cfg.smtp) ? cfg.smtp : {};
  const postfix = isObject(cfg.postfix) ? cfg.postfix : {};
  const { user: smtpUser, pass: smtpPass } = await resolveSmtpCredentials(smtp, vault);

  const { via, exec } = resolveConfigureTarget(cfg);
  errout.write(`[hdc] ${target} ${verb}: configuring Postfix via ${via} (${exec.label}) …\n`);

  try {
    const configResult = configurePostfixRelay({
      exec,
      log,
      postfix,
      smtp,
      smtpUser,
      smtpPass,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          target,
          verb,
          mode,
          system_id: inv.systemId,
          configure_via: via,
          provision: provisionResult,
          configure: configResult,
        },
        null,
        2,
      )}\n`,
    );
  } catch (e) {
    const msg = /** @type {Error} */ (e).message || String(e);
    errout.write(`[hdc] ${target} ${verb}: configure failed: ${msg}\n`);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          target,
          verb,
          mode,
          system_id: inv.systemId,
          provision: provisionResult,
          message: msg,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});
