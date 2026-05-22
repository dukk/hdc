import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { vaultKeyForProxmoxSshPassword } from "../../../../tools/hdc/lib/ssh-host-access.mjs";
import {
  discoverLocalSshMaterial,
  shellSingleQuote,
  sshBashLc,
  sshReachableWithPubkey,
  sshSpawn,
} from "../../../../tools/hdc/lib/ssh-host-access.mjs";
import { clusterConfigByKey, isProxmoxConfigObject, loadProxmoxHostsByCluster } from "./proxmox-config.mjs";
import {
  authorizeProxmoxForHost,
  parsePveApiTokenValue,
  pveTokenAclId,
  proxmoxMaintainVerifyPaths,
  readProxmoxApiTokenRaw,
} from "./proxmox-deploy-auth.mjs";
import { lxcTemplateStorageFromConfig } from "./proxmox-provision-config.mjs";
import { listProxmoxHypervisorSshTargets } from "./proxmox-host-os-maintain.mjs";
import {
  HDC_PROXMOX_API_PRIVILEGES,
  pveProfileForMajor,
  resolveClusterPveProfile,
} from "./pve-version.mjs";

export { HDC_PROXMOX_API_PRIVILEGES } from "./pve-version.mjs";

/** Proxmox role assigned to the hdc API token (created/updated via pveum over SSH). */
export const HDC_PROXMOX_API_ROLE = "HDCMaintain";

/**
 * @param {unknown} cfg
 */
export function apiTokenMaintainEnabledFromConfig(cfg) {
  if (!isProxmoxConfigObject(cfg)) return true;
  const provision = cfg.provision;
  if (!isProxmoxConfigObject(provision)) return true;
  const apiToken = provision.api_token;
  if (!isProxmoxConfigObject(apiToken)) return true;
  return apiToken.enabled !== false && apiToken.enabled !== 0;
}

/**
 * @param {unknown} cfg
 * @returns {string}
 */
export function apiTokenRoleFromConfig(cfg) {
  if (!isProxmoxConfigObject(cfg)) return HDC_PROXMOX_API_ROLE;
  const provision = cfg.provision;
  if (!isProxmoxConfigObject(provision)) return HDC_PROXMOX_API_ROLE;
  const apiToken = provision.api_token;
  if (!isProxmoxConfigObject(apiToken)) return HDC_PROXMOX_API_ROLE;
  const role = apiToken.role;
  return typeof role === "string" && role.trim() ? role.trim() : HDC_PROXMOX_API_ROLE;
}

/**
 * @param {unknown} cfg
 * @returns {string[]}
 */
export function apiTokenPrivilegesFromConfig(cfg, profile = pveProfileForMajor(8)) {
  if (!isProxmoxConfigObject(cfg)) return [...profile.apiTokenPrivileges];
  const provision = cfg.provision;
  if (!isProxmoxConfigObject(provision)) return [...profile.apiTokenPrivileges];
  const apiToken = provision.api_token;
  if (!isProxmoxConfigObject(apiToken)) return [...profile.apiTokenPrivileges];
  const privs = apiToken.privileges;
  if (!Array.isArray(privs) || !privs.length) return [...profile.apiTokenPrivileges];
  return privs.map((p) => String(p).trim()).filter(Boolean);
}

/**
 * @param {string} role
 * @param {string[]} privs
 */
export function pveumEnsureRoleCommands(role, privs) {
  const privArg = shellSingleQuote(privs.join(","));
  const roleQ = shellSingleQuote(role);
  return [
    `if pveum role list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qxF ${roleQ}; then`,
    `pveum role modify ${roleQ} -privs ${privArg}`,
    `else`,
    `pveum role add ${roleQ} -privs ${privArg}`,
    `fi`,
  ];
}

/**
 * @param {string} role
 * @param {string[]} privs
 * @param {string} tokenAcl
 */
export function pveumEnsureRoleAndAclScript(role, privs, tokenAcl) {
  return [...pveumEnsureRoleCommands(role, privs), pveumEnsureTokenAclCommand(tokenAcl, role)].join("; ");
}

/**
 * @param {string} tokenAcl e.g. root@pam!hdc-token
 * @param {string} role
 */
export function pveumEnsureTokenAclCommand(tokenAcl, role) {
  return `pveum acl modify / -token ${shellSingleQuote(tokenAcl)} -role ${shellSingleQuote(role)} -propagate 1`;
}

/**
 * @param {object} opts
 * @param {{ user: string; host: string; id: string }} opts.target
 * @param {string} opts.tokenAcl
 * @param {string} opts.role
 * @param {string[]} opts.privs
 * @param {typeof import("node:child_process").spawnSync} opts.spawnSync
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {{ privateKey: string; certificateFile?: string }[]} opts.identities
 * @param {string | null} opts.password
 * @param {boolean} opts.dryRun
 * @param {(line: string) => void} opts.log
 */
async function ensureTokenAclViaSsh(opts) {
  const { target, tokenAcl, role, privs, spawnSync, env, identities, password, dryRun, log } = opts;
  const script = pveumEnsureRoleAndAclScript(role, privs, tokenAcl);

  if (dryRun) {
    log(`[${target.id}] would run on ${target.user}@${target.host}: ${script}`);
    return { ok: true };
  }

  /** @type {"pubkey" | "password"} */
  let mode = "pubkey";
  if (!sshReachableWithPubkey(target, spawnSync, env, identities)) {
    if (!password) return { ok: false, error: "SSH unreachable and no password in vault" };
    mode = "password";
  }

  const r = sshBashLc(target, script, {
    spawnSync,
    env,
    mode,
    identities,
    password: mode === "password" ? password : undefined,
    timeoutMs: 120_000,
  });

  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim() || `ssh exit ${r.status}`;
    return { ok: false, error: err };
  }
  return { ok: true };
}

/**
 * @param {object} opts
 * @param {string} opts.packageRoot
 * @param {(line: string) => void} opts.log
 * @param {(line: string) => void} opts.warn
 * @param {import("../../../../tools/hdc/lib/vault-access.mjs").ReturnType<import("../../../../tools/hdc/lib/vault-access.mjs").createVaultAccess>} opts.vault
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {typeof import("node:child_process").spawnSync} opts.spawnSync
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runProxmoxApiTokenMaintain(opts) {
  const { packageRoot, log, warn, vault, env, spawnSync, dryRun = false } = opts;
  const configPath = join(packageRoot, "config.json");
  const configRel = "packages/infrastructure/proxmox/config.json";

  if (!existsSync(configPath)) {
    warn(`API token maintain: missing ${configRel} — skip.`);
    return { ok: true };
  }

  /** @type {unknown} */
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    warn(`API token maintain: invalid JSON: ${/** @type {Error} */ (e).message}`);
    return { ok: false };
  }

  if (!apiTokenMaintainEnabledFromConfig(cfg)) {
    log("API token maintain: disabled (provision.api_token.enabled=false) — skip.");
    return { ok: true };
  }

  const role = apiTokenRoleFromConfig(cfg);
  const lxcStorage = lxcTemplateStorageFromConfig(cfg);
  const sshTargets = listProxmoxHypervisorSshTargets(cfg, env);
  const sshById = new Map(sshTargets.map((t) => [t.id, t]));

  const byCluster = loadProxmoxHostsByCluster(cfg, {
    configPath,
    configRel,
    onSkip: (id, reason) => warn(`skip host ${JSON.stringify(id)} (${reason})`),
  });

  const { publicKeyLines, identities } = discoverLocalSshMaterial();
  if (!publicKeyLines.length && !dryRun) {
    warn("API token maintain: no local SSH public keys — need password in vault for pveum.");
  }

  let ok = true;

  for (const [clusterKey, members] of [...byCluster.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!members?.length) continue;
    const lead = members[0];
    const sshTarget = sshById.get(lead.id);
    if (!sshTarget) {
      ok = false;
      warn(`Cluster ${JSON.stringify(clusterKey)}: no SSH target for ${JSON.stringify(lead.id)} — skip ACL.`);
      continue;
    }

    const rawToken = await readProxmoxApiTokenRaw({ vault, hostId: lead.id, env });
    if (!rawToken) {
      ok = false;
      warn(
        `Cluster ${JSON.stringify(clusterKey)}: no API token in vault for ${JSON.stringify(lead.id)} (set HDC_PROXMOX_API_TOKEN or HDC_PROXMOX_API_TOKEN_${lead.id.toUpperCase().replace(/-/g, "_")}).`,
      );
      continue;
    }

    const parsed = parsePveApiTokenValue(rawToken);
    if (!parsed) {
      ok = false;
      warn(`Cluster ${JSON.stringify(clusterKey)}: cannot parse API token for ${JSON.stringify(lead.id)}.`);
      continue;
    }

    const tokenAcl = pveTokenAclId(parsed);
    const configCluster = clusterConfigByKey(cfg, clusterKey);

    const data = (await vault.readSecrets({})) ?? {};
    const pwKey = vaultKeyForProxmoxSshPassword(lead.id);
    const password = typeof data[pwKey] === "string" && data[pwKey].trim() ? data[pwKey].trim() : null;

    /** @type {string} */
    let cliVersionOutput = "";
    if (!dryRun) {
      const probe = sshSpawn(sshTarget, ["pve", "version"], {
        spawnSync,
        env,
        mode: password ? "password" : "pubkey",
        identities,
        password: password ?? undefined,
        timeoutMs: 30_000,
      });
      if (probe.status === 0 && probe.stdout) cliVersionOutput = String(probe.stdout);
    }

    const resolved = await resolveClusterPveProfile({ configCluster, cliVersionOutput });
    const profile = resolved?.profile ?? pveProfileForMajor(8);
    const privs = apiTokenPrivilegesFromConfig(cfg, profile);
    log(
      `Cluster ${JSON.stringify(clusterKey)}: ${resolved ? `PVE ${resolved.version.release} (${profile.id}) — ` : ""}ensure role ${JSON.stringify(role)} and ACL for token ${JSON.stringify(tokenAcl)} via ${JSON.stringify(lead.id)} …`,
    );

    const sshResult = await ensureTokenAclViaSsh({
      target: sshTarget,
      tokenAcl,
      role,
      privs,
      spawnSync,
      env,
      identities,
      password,
      dryRun,
      log,
    });

    if (!sshResult.ok) {
      ok = false;
      warn(
        `Cluster ${JSON.stringify(clusterKey)}: pveum on ${JSON.stringify(lead.id)} failed: ${sshResult.error ?? "unknown"}`,
      );
      continue;
    }

    if (!dryRun) {
      log(`Cluster ${JSON.stringify(clusterKey)}: ACL applied; verifying API token on ${JSON.stringify(lead.id)} …`);
      const verifyPaths = proxmoxMaintainVerifyPaths(lead.pveNode, lxcStorage);
      try {
        await authorizeProxmoxForHost({
          packageRoot,
          hostId: lead.id,
          vault,
          configCluster,
          verifyPaths,
        });
        log(`Cluster ${JSON.stringify(clusterKey)}: API token OK (${verifyPaths.length} probe path(s)).`);
      } catch (e) {
        ok = false;
        warn(
          `Cluster ${JSON.stringify(clusterKey)}: token verify failed on ${JSON.stringify(lead.id)}: ${/** @type {Error} */ (e).message || e}`,
        );
      }
    }
  }

  if (ok) log("API token permissions OK on all cluster groups.");
  else log("API token permission ensure failed on one or more clusters — see warnings.");

  return { ok };
}
