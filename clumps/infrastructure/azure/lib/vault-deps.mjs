import { env } from "node:process";

import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";

export const AZURE_CLIENT_SECRET_VAULT_KEY = "HDC_AZURE_CLIENT_SECRET";

/**
 * @returns {ReturnType<typeof createPackageVaultAccess>}
 */
export function createAzureVaultAccess() {
  return createPackageVaultAccess();
}

/** @deprecated Use createAzureVaultAccess */
export const createAzureEntraVaultAccess = createAzureVaultAccess;

/**
 * @param {ReturnType<typeof createPackageVaultAccess>} vault
 */
export async function resolveAzureClientSecret(vault) {
  await vault.unlock({});
  const secret = await vault.getSecret(AZURE_CLIENT_SECRET_VAULT_KEY);
  if (!secret || !String(secret).trim()) {
    throw new Error(
      `${AZURE_CLIENT_SECRET_VAULT_KEY} is not set. Run: node apps/hdc-cli/cli.mjs secrets set ${AZURE_CLIENT_SECRET_VAULT_KEY}`
    );
  }
  return String(secret).trim();
}

/**
 * @returns {string}
 */
export function resolveAzureTenantId() {
  const v =
    typeof env.HDC_AZURE_TENANT_ID === "string" ? env.HDC_AZURE_TENANT_ID.trim() : "";
  if (!v) {
    throw new Error("HDC_AZURE_TENANT_ID is not set in .env");
  }
  return v;
}

/**
 * @returns {string}
 */
export function resolveAzureClientId() {
  const v =
    typeof env.HDC_AZURE_CLIENT_ID === "string" ? env.HDC_AZURE_CLIENT_ID.trim() : "";
  if (!v) {
    throw new Error("HDC_AZURE_CLIENT_ID is not set in .env");
  }
  return v;
}
