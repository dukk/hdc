/** Keys that always stay in the local ~/.hdc/vault.enc (bootstrap / chicken-and-egg). */
export const LOCAL_ONLY_VAULT_KEYS = new Set([
  "HDC_VAULTWARDEN_MASTER_PASSWORD",
  "HDC_VAULTWARDEN_ADMIN_TOKEN",
]);

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function isAutoSecretBackend(env) {
  const raw = String(env.HDC_SECRET_BACKEND ?? "auto").trim().toLowerCase();
  return raw === "auto" || raw === "";
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {"local" | "vaultwarden"}
 */
export function resolveSecretBackendMode(env) {
  const raw = String(env.HDC_SECRET_BACKEND ?? "auto").trim().toLowerCase();
  if (raw === "local") return "local";
  if (raw === "vaultwarden") return "vaultwarden";
  if (vaultwardenConfigured(env)) return "vaultwarden";
  return "local";
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function vaultwardenConfigured(env) {
  return Boolean(
    String(env.HDC_VAULTWARDEN_URL ?? "").trim() && String(env.HDC_VAULTWARDEN_EMAIL ?? "").trim(),
  );
}

/**
 * @param {string} key
 */
export function isLocalOnlyVaultKey(key) {
  return LOCAL_ONLY_VAULT_KEYS.has(key);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function vaultwardenOrganizationIdFromEnv(env) {
  const id = String(env.HDC_VAULTWARDEN_ORGANIZATION_ID ?? "").trim();
  return id.length > 0 ? id : null;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function vaultwardenOrganizationNameFromEnv(env) {
  const name = String(env.HDC_VAULTWARDEN_ORGANIZATION_NAME ?? "").trim();
  return name.length > 0 ? name : "HDC";
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function vaultwardenCollectionIdFromEnv(env) {
  const id = String(env.HDC_VAULTWARDEN_COLLECTION_ID ?? "").trim();
  return id.length > 0 ? id : null;
}
