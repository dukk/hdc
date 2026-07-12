import { createVaultAccess, vaultDepsFromCli } from "../../../../apps/hdc-cli/lib/vault-access.mjs";

/**
 * @returns {ReturnType<typeof createVaultAccess>}
 */
export function createSynologyVaultAccess() {
  return createVaultAccess(vaultDepsFromCli());
}
