import { createVaultAccess, vaultDepsFromCli } from "../../../../tools/hdc/lib/vault-access.mjs";

export const CLOUDFLARE_TOKEN_VAULT_KEY = "HDC_CLOUDFLARE_API_TOKEN";

/**
 * @returns {ReturnType<typeof createVaultAccess>}
 */
export function createCloudflareVaultAccess() {
  return createVaultAccess(vaultDepsFromCli());
}

/**
 * @param {ReturnType<typeof createVaultAccess>} vault
 */
export async function resolveCloudflareToken(vault) {
  await vault.unlock({});
  const token = await vault.getSecret(CLOUDFLARE_TOKEN_VAULT_KEY);
  if (!token || !String(token).trim()) {
    throw new Error(
      `${CLOUDFLARE_TOKEN_VAULT_KEY} is not set. Run: node tools/hdc/cli.mjs secrets set ${CLOUDFLARE_TOKEN_VAULT_KEY}`
    );
  }
  return String(token).trim();
}
