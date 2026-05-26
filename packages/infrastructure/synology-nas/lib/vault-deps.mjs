import { createVaultAccess, vaultDepsFromCli } from "../../../../tools/hdc/lib/vault-access.mjs";

/**
 * @returns {ReturnType<typeof createVaultAccess>}
 */
export function createSynologyVaultAccess() {
  return createVaultAccess(vaultDepsFromCli());
}
