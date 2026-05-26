import { env as processEnv } from "node:process";

import { flagGet } from "./parse-argv-flags.mjs";
import {
  remoteEnsureLocalAdminUserBash,
  validateLinuxUsername,
} from "./linux-local-admin-user.mjs";
import { createPackageVaultAccess } from "./package-vault-access.mjs";

export const ADMIN_USER_ENV = "HDC_ADMIN_USER";
export const ADMIN_USER_PASSWORD_VAULT_KEY = "HDC_ADMIN_USER_PASSWORD";

/** @type {Promise<string> | null} */
let cachedAdminPasswordPromise = null;

/**
 * Reset password cache (tests).
 */
export function resetAdminPasswordCache() {
  cachedAdminPasswordPromise = null;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveAdminUsername(env = processEnv) {
  const raw = env[ADMIN_USER_ENV];
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) {
    throw new Error(
      `${ADMIN_USER_ENV} is not set — add it to the repo .env (see .env.example)`,
    );
  }
  return validateLinuxUsername(v);
}

/**
 * @param {Record<string, string>} [flags]
 * @returns {boolean}
 */
export function adminUserSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-admin-user", "skip_admin_user") !== undefined;
}

/**
 * @param {ReturnType<typeof createPackageVaultAccess>} [vaultAccess]
 * @returns {Promise<string>}
 */
export async function resolveAdminPassword(vaultAccess) {
  if (!cachedAdminPasswordPromise) {
    cachedAdminPasswordPromise = (async () => {
      const vault = vaultAccess ?? createPackageVaultAccess();
      await vault.unlock({});
      const password = await vault.getSecret(ADMIN_USER_PASSWORD_VAULT_KEY, {
        promptLabel: `Local admin password (${ADMIN_USER_PASSWORD_VAULT_KEY})`,
      });
      const trimmed = String(password).trim();
      if (!trimmed) {
        throw new Error(`${ADMIN_USER_PASSWORD_VAULT_KEY} must not be empty`);
      }
      return trimmed;
    })();
  }
  return cachedAdminPasswordPromise;
}

/**
 * @typedef {object} AdminUserEnsureResult
 * @property {boolean} ok
 * @property {boolean} skipped
 * @property {string} [username]
 * @property {string} message
 */

/**
 * Ensure local sudo admin user exists with password from vault.
 *
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {ReturnType<typeof createPackageVaultAccess>} [opts.vaultAccess]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {Promise<AdminUserEnsureResult>}
 */
export async function ensureAdminUser({ exec, log, flags, vaultAccess, env }) {
  if (adminUserSkippedByFlags(flags)) {
    log.info(`${exec.label}: local admin user skipped (--skip-admin-user)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  let username;
  try {
    username = resolveAdminUsername(env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }

  let password;
  try {
    password = await resolveAdminPassword(vaultAccess);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: ${msg}`);
    return { ok: false, skipped: false, username, message: msg };
  }

  const pwB64 = Buffer.from(password, "utf8").toString("base64");
  const remote = remoteEnsureLocalAdminUserBash(username, pwB64);

  try {
    log.info(
      `${exec.label}: ensuring local admin user ${username} (${ADMIN_USER_PASSWORD_VAULT_KEY})`,
    );
    const r = exec.run(remote, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    return { ok: true, skipped: false, username, message: "ensured" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: local admin user ensure failed: ${msg}`);
    return { ok: false, skipped: false, username, message: msg };
  }
}
