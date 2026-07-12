/** Keys that always stay in the local ~/.hdc/vault.enc (bootstrap / chicken-and-egg). */
export const LOCAL_ONLY_VAULT_KEYS = new Set([
  "HDC_VAULTWARDEN_MASTER_PASSWORD",
  "HDC_VAULTWARDEN_ADMIN_TOKEN",
  "HDC_VAULTWARDEN_KEY_CLIENT_ID",
  "HDC_VAULTWARDEN_KEY_CLIENT_SECRET",
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
 * @returns {string | null}
 */
export function vaultwardenKeyClientIdFromEnv(env) {
  const id = String(env.HDC_VAULTWARDEN_KEY_CLIENT_ID ?? "").trim();
  return id.length > 0 ? id : null;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function vaultwardenKeyClientSecretFromEnv(env) {
  const secret = String(env.HDC_VAULTWARDEN_KEY_CLIENT_SECRET ?? "").trim();
  return secret.length > 0 ? secret : null;
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function vaultwardenApiKeyConfigured(env) {
  return Boolean(vaultwardenKeyClientIdFromEnv(env) && vaultwardenKeyClientSecretFromEnv(env));
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {"apikey" | "password" | null}
 */
export function vaultwardenAuthMode(env) {
  if (vaultwardenApiKeyConfigured(env)) return "apikey";
  if (String(env.HDC_VAULTWARDEN_EMAIL ?? "").trim()) return "password";
  return null;
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function vaultwardenConfigured(env) {
  const url = String(env.HDC_VAULTWARDEN_URL ?? "").trim();
  if (!url) return false;
  return vaultwardenAuthMode(env) !== null;
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
