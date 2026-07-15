import { env as processEnv } from "node:process";

export const DEFAULT_GUEST_SSH_USER = "hdc";
export const FALLBACK_BOOTSTRAP_SSH_USER = "root";
export const GUEST_SSH_USER_ENV = "HDC_GUEST_SSH_USER";

/**
 * @param {unknown} configuredUser
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveGuestSshUser(configuredUser, env = processEnv) {
  if (typeof configuredUser === "string" && configuredUser.trim()) {
    const trimmed = configuredUser.trim();
    // Legacy configure.ssh.user "root" — prefer hdc; createGuestSshExec falls back to root.
    if (trimmed !== FALLBACK_BOOTSTRAP_SSH_USER) {
      return trimmed;
    }
  }
  const fromEnv = env[GUEST_SSH_USER_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return DEFAULT_GUEST_SSH_USER;
}

/**
 * @param {unknown} deployment
 * @returns {string | null}
 */
export function systemIdFromDeployment(deployment) {
  if (!deployment || typeof deployment !== "object" || Array.isArray(deployment)) return null;
  const d = /** @type {Record<string, unknown>} */ (deployment);
  const sid = d.system_id ?? d.systemId;
  return typeof sid === "string" && sid.trim() ? sid.trim() : null;
}
