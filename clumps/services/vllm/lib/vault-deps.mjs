import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";

/**
 * @returns {ReturnType<typeof createPackageVaultAccess>}
 */
export function createVllmVaultAccess() {
  return createPackageVaultAccess();
}
