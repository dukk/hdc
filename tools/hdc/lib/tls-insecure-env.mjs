/** Global default when per-integration `HDC_*_TLS_INSECURE` is unset or empty. */
export const HDC_TLS_INSECURE_ENV = "HDC_TLS_INSECURE";

/**
 * When TLS verification is disabled, which env var caused it (for operator messages).
 * @param {NodeJS.ProcessEnv} env
 * @param {string} specificKey e.g. HDC_PROXMOX_TLS_INSECURE
 * @returns {string | null} specificKey, HDC_TLS_INSECURE, or null when verification stays on
 */
export function hdcTlsInsecureSourceEnv(env, specificKey) {
  const v = env[specificKey];
  if (v === "1") return specificKey;
  if (v !== undefined && v !== "") return null;
  return env[HDC_TLS_INSECURE_ENV] === "1" ? HDC_TLS_INSECURE_ENV : null;
}

/**
 * Node `https.Agent`/fetch-style: `true` means verify server certificates.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} specificKey
 */
export function hdcTlsRejectUnauthorized(env, specificKey) {
  return hdcTlsInsecureSourceEnv(env, specificKey) === null;
}
