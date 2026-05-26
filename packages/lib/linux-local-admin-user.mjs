/** Valid Linux login names (lowercase; Debian/Ubuntu default). */
export const LINUX_USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

/**
 * @param {string} username
 * @returns {string}
 */
export function validateLinuxUsername(username) {
  const u = typeof username === "string" ? username.trim() : "";
  if (!u) {
    throw new Error("Linux username is required");
  }
  if (!LINUX_USERNAME_RE.test(u)) {
    throw new Error(
      `Invalid Linux username ${JSON.stringify(u)} (use lowercase letters, digits, _, -; max 32 chars)`,
    );
  }
  return u;
}

/**
 * Bash to create/update a local user with sudo/wheel and set password from base64 payload.
 * @param {string} username validated via {@link validateLinuxUsername}
 * @param {string} passwordB64 base64-encoded UTF-8 password (no shell metacharacters in username)
 * @returns {string}
 */
export function remoteEnsureLocalAdminUserBash(username, passwordB64) {
  const u = validateLinuxUsername(username);
  return [
    "set -euo pipefail",
    `PW=$(printf '%s' '${passwordB64}' | base64 -d)`,
    `if ! id -u ${u} >/dev/null 2>&1; then useradd -m -s /bin/bash ${u}; fi`,
    `if getent group sudo >/dev/null 2>&1; then usermod -aG sudo ${u} 2>/dev/null || true; fi`,
    `if getent group wheel >/dev/null 2>&1; then usermod -aG wheel ${u} 2>/dev/null || true; fi`,
    `printf '%s\\n' "${u}:$PW" | chpasswd`,
  ].join("; ");
}

/**
 * @param {string} passwordB64
 * @returns {string}
 */
export function remoteBootstrapHdcBash(passwordB64) {
  return remoteEnsureLocalAdminUserBash("hdc", passwordB64);
}
