/** @typedef {"both" | "htpasswd" | "oidc"} WebAuthMode */

export const DEFAULT_AUTH_MODE = /** @type {const} */ ("both");

/** @type {readonly WebAuthMode[]} */
export const VALID_AUTH_MODES = ["both", "htpasswd", "oidc"];

/**
 * @param {unknown} mode
 * @returns {WebAuthMode}
 */
export function normalizeAuthMode(mode) {
  const m = typeof mode === "string" ? mode.trim() : "";
  if (m === "both" || m === "htpasswd" || m === "oidc") {
    return /** @type {WebAuthMode} */ (m);
  }
  return DEFAULT_AUTH_MODE;
}

/**
 * @param {unknown} mode
 * @returns {boolean}
 */
export function passwordLoginEnabledForMode(mode) {
  return normalizeAuthMode(mode) !== "oidc";
}

/**
 * @param {unknown} webConfig
 * @returns {{ mode: WebAuthMode; htpasswdFile: string; adminUsername: string }}
 */
export function resolveAuthConfig(webConfig) {
  const auth =
    webConfig &&
    typeof webConfig === "object" &&
    /** @type {Record<string, unknown>} */ (webConfig).auth &&
    typeof /** @type {Record<string, unknown>} */ (webConfig).auth === "object"
      ? /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (webConfig).auth)
      : {};
  const mode = normalizeAuthMode(auth.mode);
  const htpasswdFile =
    typeof auth.htpasswd_file === "string" && auth.htpasswd_file.trim()
      ? auth.htpasswd_file.trim()
      : ".htpasswd.enc";
  const adminUsername =
    typeof auth.admin_username === "string" && auth.admin_username.trim()
      ? auth.admin_username.trim()
      : "admin";
  return { mode, htpasswdFile, adminUsername };
}

/**
 * Default auth block for web-config.json when the file is missing.
 */
export function defaultWebConfigAuth() {
  return {
    mode: DEFAULT_AUTH_MODE,
    htpasswd_file: ".htpasswd.enc",
    admin_username: "admin",
  };
}
