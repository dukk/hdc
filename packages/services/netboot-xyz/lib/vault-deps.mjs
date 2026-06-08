import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";

/** No package-specific vault keys; guest baseline uses shared package vault access. */
export function createNetbootXyzVaultAccess() {
  return createPackageVaultAccess();
}
