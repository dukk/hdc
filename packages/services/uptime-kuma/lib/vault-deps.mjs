import { env } from "node:process";

import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";

export const UPTIME_KUMA_USERNAME_ENV = "HDC_UPTIME_KUMA_USERNAME";
export const UPTIME_KUMA_PASSWORD_VAULT_KEY = "HDC_UPTIME_KUMA_PASSWORD";

/**
 * @returns {ReturnType<typeof createPackageVaultAccess>}
 */
export function createUptimeKumaVaultAccess() {
  return createPackageVaultAccess();
}

/**
 * @param {ReturnType<typeof createPackageVaultAccess>} vault
 * @param {string} vaultKey
 */
async function resolveFromVault(vault, vaultKey) {
  await vault.unlock({});
  try {
    const secrets = await vault.readSecrets({ createIfMissing: false });
    const fromVault = secrets?.[vaultKey];
    if (typeof fromVault === "string" && fromVault.trim()) {
      return fromVault.trim();
    }
  } catch {
    // Vault missing, locked, or unavailable
  }
  return null;
}

/**
 * @param {ReturnType<typeof createPackageVaultAccess>} vault
 * @param {string} [usernameEnv]
 */
export async function resolveUptimeKumaUsername(usernameEnv = UPTIME_KUMA_USERNAME_ENV) {
  const fromEnv = typeof env[usernameEnv] === "string" ? env[usernameEnv].trim() : "";
  if (fromEnv) return fromEnv;
  throw new Error(
    `${usernameEnv} is not set. Add it to repo .env (admin username for Uptime Kuma web UI).`,
  );
}

/**
 * @param {ReturnType<typeof createPackageVaultAccess>} vault
 * @param {string} [passwordVaultKey]
 */
export async function resolveUptimeKumaPassword(
  vault,
  passwordVaultKey = UPTIME_KUMA_PASSWORD_VAULT_KEY,
) {
  const fromVault = await resolveFromVault(vault, passwordVaultKey);
  if (fromVault) return fromVault;
  throw new Error(
    `${passwordVaultKey} is not set. Run: node tools/hdc/cli.mjs secrets set ${passwordVaultKey}`,
  );
}

/**
 * @param {ReturnType<typeof createPackageVaultAccess>} vault
 * @param {{ usernameEnv?: string; passwordVaultKey?: string }} [auth]
 */
export async function resolveUptimeKumaCredentials(vault, auth = {}) {
  const usernameEnv = auth.usernameEnv ?? UPTIME_KUMA_USERNAME_ENV;
  const passwordVaultKey = auth.passwordVaultKey ?? UPTIME_KUMA_PASSWORD_VAULT_KEY;
  const username = await resolveUptimeKumaUsername(usernameEnv);
  const password = await resolveUptimeKumaPassword(vault, passwordVaultKey);
  return { username, password, usernameEnv, passwordVaultKey };
}
