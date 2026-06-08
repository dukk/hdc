import { createVaultAccess, vaultDepsFromCli } from "../../../../tools/hdc/lib/vault-access.mjs";

export const AZURE_CLIENT_SECRET_VAULT_KEY = "HDC_AZURE_CLIENT_SECRET";

/**
 * @returns {ReturnType<typeof createVaultAccess>}
 */
export function createAzureEntraVaultAccess() {
  return createVaultAccess(vaultDepsFromCli());
}

/**
 * @param {ReturnType<typeof createVaultAccess>} vault
 */
export async function resolveAzureClientSecret(vault) {
  await vault.unlock({});
  const secret = await vault.getSecret(AZURE_CLIENT_SECRET_VAULT_KEY);
  if (!secret || !String(secret).trim()) {
    throw new Error(
      `${AZURE_CLIENT_SECRET_VAULT_KEY} is not set. Run: node tools/hdc/cli.mjs secrets set ${AZURE_CLIENT_SECRET_VAULT_KEY}`
    );
  }
  return String(secret).trim();
}

/**
 * @returns {string}
 */
export function resolveAzureTenantId() {
  const v =
    typeof process.env.HDC_AZURE_TENANT_ID === "string" ? process.env.HDC_AZURE_TENANT_ID.trim() : "";
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
    typeof process.env.HDC_AZURE_CLIENT_ID === "string" ? process.env.HDC_AZURE_CLIENT_ID.trim() : "";
  if (!v) {
    throw new Error("HDC_AZURE_CLIENT_ID is not set in .env");
  }
  return v;
}
