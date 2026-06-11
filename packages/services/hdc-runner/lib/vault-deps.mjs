import { createPackageVaultAccess } from "../../../lib/package-vault-access.mjs";

export function createHdcRunnerVaultAccess() {
  return createPackageVaultAccess();
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
