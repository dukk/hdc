import { stderr as errout } from "node:process";

import { loadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import {
  parsePveApiTokenSecret,
  proxmoxHostEnvSlug,
  proxmoxHostWebUiFromConfig,
  proxmoxWidgetUsernameFromToken,
  runProxmoxServiceAccountMaintain,
  serviceAccountById,
} from "../../../infrastructure/proxmox/lib/proxmox-service-account-maintain.mjs";

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} homepage
 */
export function proxmoxWidgetEnabled(homepage) {
  const widget = homepage.proxmox_widget;
  if (!isObject(widget)) return false;
  return widget.enabled !== false && widget.enabled !== 0;
}

/**
 * @param {Record<string, unknown>} homepage
 * @returns {{ serviceAccountId: string; hosts: string[] } | null}
 */
export function proxmoxWidgetSettings(homepage) {
  if (!proxmoxWidgetEnabled(homepage)) return null;
  const widget = /** @type {Record<string, unknown>} */ (homepage.proxmox_widget);
  const serviceAccountId =
    typeof widget.service_account_id === "string" ? widget.service_account_id.trim() : "homepage";
  const hosts = Array.isArray(widget.hosts)
    ? widget.hosts.map((h) => String(h).trim()).filter(Boolean)
    : [];
  if (!serviceAccountId) return null;
  return { serviceAccountId, hosts };
}

/**
 * @param {unknown} proxmoxCfg
 * @param {string} serviceAccountId
 */
export function tokenVaultKeyForServiceAccount(proxmoxCfg, serviceAccountId) {
  const account = serviceAccountById(proxmoxCfg, serviceAccountId);
  return account?.token_vault_key ?? null;
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} opts.homepage
 * @param {string} opts.proxmoxPackageRoot
 * @param {import("../../../lib/package-vault-access.mjs").PackageVaultAccess} opts.vaultAccess
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {typeof import("node:child_process").spawnSync} opts.spawnSync
 * @param {(q: string, o?: { mask?: boolean }) => Promise<string>} [opts.readLineQuestion]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ lines: string[]; service_account_id: string; token_vault_key: string } | null>}
 */
export async function resolveHomepageProxmoxWidgetEnv(opts) {
  const { homepage, proxmoxPackageRoot, vaultAccess, env, spawnSync, readLineQuestion, dryRun = false } =
    opts;

  const settings = proxmoxWidgetSettings(homepage);
  if (!settings) return null;

  const proxmoxLoaded = loadPackageConfigFromPackageRoot(proxmoxPackageRoot, {
    exampleRel: "packages/infrastructure/proxmox/config.example.json",
  });
  const proxmoxCfg = proxmoxLoaded.data;
  const account = serviceAccountById(proxmoxCfg, settings.serviceAccountId);
  if (!account) {
    throw new Error(
      `homepage.proxmox_widget.service_account_id ${JSON.stringify(settings.serviceAccountId)} not found in proxmox config provision.service_accounts[]`,
    );
  }

  errout.write(
    `[hdc] homepage: ensuring Proxmox service account ${JSON.stringify(settings.serviceAccountId)} …\n`,
  );

  const vault = vaultAccess;
  const saResult = await runProxmoxServiceAccountMaintain({
    packageRoot: proxmoxPackageRoot,
    log: (line) => errout.write(`[hdc] homepage proxmox: ${line}\n`),
    warn: (line) => errout.write(`[hdc] homepage proxmox: WARN ${line}\n`),
    vault,
    env,
    spawnSync,
    dryRun,
    readLineQuestion,
    filterIds: [settings.serviceAccountId],
  });
  if (!saResult.ok) {
    throw new Error(`Proxmox service account ${JSON.stringify(settings.serviceAccountId)} ensure failed`);
  }

  if (dryRun) {
    return {
      lines: [`# dry-run: would inject HOMEPAGE_VAR_PROXMOX_* for ${settings.serviceAccountId}`],
      service_account_id: settings.serviceAccountId,
      token_vault_key: account.token_vault_key,
    };
  }

  const data = (await vault.readSecrets({})) ?? {};
  const rawToken =
    typeof data[account.token_vault_key] === "string" ? data[account.token_vault_key].trim() : "";
  if (!rawToken) {
    throw new Error(
      `vault missing ${JSON.stringify(account.token_vault_key)} after service account ensure — run proxmox maintain`,
    );
  }

  const username = proxmoxWidgetUsernameFromToken(rawToken);
  const secret = parsePveApiTokenSecret(rawToken);
  if (!username || !secret) {
    throw new Error(`cannot parse Proxmox widget credentials from vault key ${JSON.stringify(account.token_vault_key)}`);
  }

  /** @type {string[]} */
  const lines = [
    `HOMEPAGE_VAR_PROXMOX_USER=${username}`,
    `HOMEPAGE_VAR_PROXMOX_SECRET=${secret}`,
  ];

  for (const hostId of settings.hosts) {
    const webUi = proxmoxHostWebUiFromConfig(proxmoxCfg, hostId);
    if (!webUi) {
      throw new Error(`proxmox host ${JSON.stringify(hostId)} not found in proxmox config for widget URL env`);
    }
    lines.push(`HOMEPAGE_VAR_PROXMOX_${proxmoxHostEnvSlug(hostId)}_URL=${webUi}`);
  }

  errout.write(
    `[hdc] homepage: Proxmox widget env ready (${settings.hosts.length} host URL(s), vault ${JSON.stringify(account.token_vault_key)}).\n`,
  );

  return {
    lines,
    service_account_id: settings.serviceAccountId,
    token_vault_key: account.token_vault_key,
  };
}
