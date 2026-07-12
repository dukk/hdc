import { env as processEnv } from "node:process";

import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";

export function createHdcRunnerVaultAccess() {
  return createPackageVaultAccess();
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {{ clientId: string; clientSecret: string } | null}
 */
export function vaultwardenApiKeyFromEnv(env = processEnv) {
  const clientId = String(env.HDC_VAULTWARDEN_KEY_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.HDC_VAULTWARDEN_KEY_CLIENT_SECRET ?? "").trim();
  if (clientId && clientSecret) return { clientId, clientSecret };
  return null;
}

/**
 * @param {ReturnType<typeof createPackageVaultAccess>} vaultAccess
 * @param {{ envMap?: Record<string, string | undefined> }} [opts]
 * @returns {Promise<{ clientId: string; clientSecret: string } | null>}
 */
export async function resolveVaultwardenApiKeyCredentials(vaultAccess, opts = {}) {
  const envMap = opts.envMap ?? {};
  const fromEnvMap = vaultwardenApiKeyFromEnv(envMap);
  if (fromEnvMap) return fromEnvMap;

  const fromProcessEnv = vaultwardenApiKeyFromEnv(processEnv);
  if (fromProcessEnv) return fromProcessEnv;

  const clientId = String(
    await vaultAccess.getSecret("HDC_VAULTWARDEN_KEY_CLIENT_ID", { optional: true }),
  ).trim();
  const clientSecret = String(
    await vaultAccess.getSecret("HDC_VAULTWARDEN_KEY_CLIENT_SECRET", { optional: true }),
  ).trim();
  if (clientId && clientSecret) return { clientId, clientSecret };
  return null;
}

/**
 * @param {ReturnType<typeof createPackageVaultAccess>} vaultAccess
 */
export async function resolveVaultwardenMasterPassword(vaultAccess) {
  const value = await vaultAccess.getSecret("HDC_VAULTWARDEN_MASTER_PASSWORD", {
    promptLabel: "Vaultwarden master password for hdc-runner guest .env",
    allowEmpty: false,
  });
  return String(value ?? "").trim();
}
