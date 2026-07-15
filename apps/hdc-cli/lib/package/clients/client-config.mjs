import { join } from "node:path";

import { loadManualSystemSidecar } from "../inventory-sidecar.mjs";
import { loadClumpConfigFromClumpRoot } from "../../clump-config.mjs";
import {
  inventoryIdToVaultSuffix,
  parseSshUrl,
  sshUserFromAuthEnv,
} from "../../users-bootstrap-hdc.mjs";

/**
 * @param {string} clumpRoot e.g. clumps/clients/windows
 */
export function clientsConfigPath(clumpRoot) {
  return join(clumpRoot, "config.json");
}

export const CLIENT_PLATFORMS = ["windows", "ubuntu", "raspberrypi"];

const WINRM_PASSWORD_PREFIX = "HDC_WINRM_PASSWORD";

/** Shared WinRM password when `auth.winrm_password_vault_suffix` is omitted. */
export const WINRM_USER_PASSWORD_VAULT_KEY = "HDC_WINRM_USER_PASSWORD";

/**
 * @param {string} suffix
 */
export function vaultKeyForWinrmPassword(suffix) {
  return `${WINRM_PASSWORD_PREFIX}_${inventoryIdToVaultSuffix(suffix)}`;
}

/**
 * Vault key for WinRM password: default `HDC_WINRM_USER_PASSWORD`; per-host via `auth.winrm_password_vault_suffix`.
 * @param {Record<string, unknown>} auth
 */
export function resolveWinrmPasswordVaultKey(auth) {
  const suffix =
    typeof auth.winrm_password_vault_suffix === "string" && auth.winrm_password_vault_suffix.trim()
      ? auth.winrm_password_vault_suffix.trim()
      : null;
  if (suffix) return vaultKeyForWinrmPassword(suffix);
  return WINRM_USER_PASSWORD_VAULT_KEY;
}

/**
 * WinRM username: per-host `auth.winrm_user` overrides env from `auth.winrm_user_env` (default `HDC_WINRM_USER`).
 * @param {Record<string, unknown>} auth
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveWinrmUser(auth, env) {
  if (typeof auth.winrm_user === "string" && auth.winrm_user.trim()) {
    return auth.winrm_user.trim();
  }
  const winrmUserEnv =
    typeof auth.winrm_user_env === "string" && auth.winrm_user_env.trim()
      ? auth.winrm_user_env.trim()
      : "HDC_WINRM_USER";
  return typeof env[winrmUserEnv] === "string" && env[winrmUserEnv].trim() ? env[winrmUserEnv].trim() : null;
}

/**
 * @param {unknown} v
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} configPath Absolute path to clumps/clients/<platform>/config.json
 */
export function loadClientConfig(configPath) {
  return loadClientConfigFromPackageRoot(join(configPath, ".."));
}

/**
 * @param {string} clumpRoot clumps/clients/<platform>
 */
export function loadClientConfigFromPackageRoot(clumpRoot) {
  const { data } = loadClumpConfigFromClumpRoot(clumpRoot);
  return data;
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function wolDefaultsFromConfig(cfg) {
  const wol = isObject(cfg.wol) ? cfg.wol : {};
  return {
    enabled: wol.enabled !== false && wol.enabled !== 0,
    broadcast: typeof wol.broadcast === "string" && wol.broadcast.trim() ? wol.broadcast.trim() : "255.255.255.255",
    port: typeof wol.port === "number" && wol.port > 0 ? wol.port : 9,
    packets: typeof wol.packets === "number" && wol.packets > 0 ? Math.round(wol.packets) : 3,
    waitSeconds:
      typeof wol.wait_seconds === "number" && wol.wait_seconds > 0 ? Math.round(wol.wait_seconds) : 180,
    pollIntervalSeconds:
      typeof wol.poll_interval_seconds === "number" && wol.poll_interval_seconds > 0
        ? Math.round(wol.poll_interval_seconds)
        : 10,
  };
}

/**
 * @param {unknown} mac
 */
export function normalizeMac(mac) {
  if (typeof mac !== "string" || !mac.trim()) return null;
  const hex = mac.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)?.join(":") ?? null;
}

/**
 * @param {Record<string, unknown>} host
 * @param {string} root
 */
export function resolveHostMac(host, root) {
  const wol = isObject(host.wol) ? host.wol : {};
  const fromWol = normalizeMac(wol.mac);
  if (fromWol) return fromWol;

  const access = isObject(host.access) ? host.access : {};
  const nodes = Array.isArray(access.nodes) ? access.nodes : [];
  for (const n of nodes) {
    if (!isObject(n)) continue;
    const m = normalizeMac(n.mac);
    if (m) return m;
  }

  const systemId = typeof host.system_id === "string" ? host.system_id.trim() : "";
  if (systemId) {
    const sidecar = loadManualSystemSidecar(root, systemId);
    if (sidecar) {
      const acc = isObject(sidecar.access) ? sidecar.access : {};
      const sn = Array.isArray(acc.nodes) ? acc.nodes : [];
      const first = sn[0];
      if (isObject(first)) {
        const m = normalizeMac(first.mac);
        if (m) return m;
      }
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} host
 * @param {NodeJS.ProcessEnv} env
 */
export function primaryNodeFromHost(host, env) {
  const access = isObject(host.access) ? host.access : {};
  const nodes = Array.isArray(access.nodes) ? access.nodes : [];
  const first = nodes.find((n) => isObject(n));
  if (!first || !isObject(first)) return null;
  const row = /** @type {Record<string, unknown>} */ (first);
  const ip = typeof row.ip === "string" && row.ip.trim() ? row.ip.trim() : null;
  if (!ip) return null;

  const sshUrl = typeof row.ssh === "string" ? row.ssh : "";
  const parsed = parseSshUrl(sshUrl);
  const auth = isObject(host.auth) ? host.auth : {};
  const sshUser =
    parsed?.user ??
    sshUserFromAuthEnv(auth, env) ??
    (typeof env.HDC_CLIENT_SSH_USER === "string" && env.HDC_CLIENT_SSH_USER.trim()
      ? env.HDC_CLIENT_SSH_USER.trim()
      : null);

  const winrm = isObject(row.winrm) ? row.winrm : {};
  const winrmPort = typeof winrm.port === "number" && winrm.port > 0 ? winrm.port : 5986;
  const winrmUser = resolveWinrmUser(auth, env);

  return {
    name: typeof row.name === "string" ? row.name : "primary",
    ip,
    sshUser,
    winrm: {
      port: winrmPort,
      useSsl: winrm.use_ssl !== false && winrm.use_ssl !== 0,
      skipCaCheck: winrm.skip_ca_check === true || winrm.skip_ca_check === 1,
    },
    winrmUser,
    winrmVaultKey: resolveWinrmPasswordVaultKey(auth),
  };
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} platform
 * @param {string | undefined} hostIdFilter
 */
export function hostsForPlatform(cfg, platform, hostIdFilter) {
  const hosts = Array.isArray(cfg.hosts) ? cfg.hosts : [];
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const h of hosts) {
    if (!isObject(h)) continue;
    const rec = /** @type {Record<string, unknown>} */ (h);
    if (rec.enabled === false || rec.enabled === 0) continue;
    const os = typeof rec.os === "string" ? rec.os.trim().toLowerCase() : "";
    if (os !== platform) continue;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    if (hostIdFilter && id !== hostIdFilter) continue;
    out.push(rec);
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * @param {Record<string, unknown>} host
 */
export function hostUpdatesEnabled(host) {
  const updates = isObject(host.updates) ? host.updates : {};
  return updates.enabled !== false && updates.enabled !== 0;
}

/**
 * @param {Record<string, unknown>} host
 * @param {ReturnType<typeof wolDefaultsFromConfig>} defaults
 */
export function hostWolEnabled(host, defaults) {
  const wol = isObject(host.wol) ? host.wol : {};
  if (wol.enabled === false || wol.enabled === 0) return false;
  return defaults.enabled;
}

/**
 * @param {Record<string, unknown>} cfg
 */
export function mailRelayDefaultsFromConfig(cfg) {
  const mr = isObject(cfg.mail_relay) ? cfg.mail_relay : {};
  return { enabled: mr.enabled !== false && mr.enabled !== 0 };
}

/**
 * @param {Record<string, unknown>} host
 * @param {ReturnType<typeof mailRelayDefaultsFromConfig>} defaults
 */
export function hostMailRelayEnabled(host, defaults) {
  const mr = isObject(host.mail_relay) ? host.mail_relay : {};
  if (mr.enabled === false || mr.enabled === 0) return false;
  if (mr.enabled === true || mr.enabled === 1) return true;
  return defaults.enabled;
}
