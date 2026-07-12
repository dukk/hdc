import { flagGet } from "./parse-argv-flags.mjs";
import {
  remoteEnsureHdcAutomationUserBash,
  remoteInstallAuthorizedKeysForUserBash,
} from "./linux-local-admin-user.mjs";
import { systemIdFromDeployment } from "./guest-ssh-resolve.mjs";
import {
  generateHdcPassword,
  vaultKeyForHdcLocalPassword,
} from "../../apps/hdc-cli/lib/users-bootstrap-hdc.mjs";
import { discoverLocalSshMaterial } from "../../apps/hdc-cli/lib/ssh-host-access.mjs";

export const HDC_AUTOMATION_USERNAME = "hdc";

/** @type {Map<string, Promise<string>>} */
const passwordCacheBySystem = new Map();

/**
 * Reset password cache (tests).
 */
export function resetHdcPasswordCache() {
  passwordCacheBySystem.clear();
}

/**
 * @param {string} systemId
 * @returns {string}
 */
export function hdcPasswordVaultKeyForSystem(systemId) {
  const sid = typeof systemId === "string" ? systemId.trim() : "";
  if (!sid) {
    throw new Error("system_id is required for hdc user vault key");
  }
  return vaultKeyForHdcLocalPassword(sid);
}

/**
 * @param {Record<string, string>} [flags]
 * @returns {boolean}
 */
export function hdcUserSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-hdc-user", "skip_hdc_user") !== undefined;
}

/**
 * @param {Record<string, string>} [flags]
 * @returns {boolean}
 */
export function hdcUserSshKeysSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-hdc-ssh-keys", "skip_hdc_ssh_keys") !== undefined;
}

/**
 * @param {string} systemId
 * @param {ReturnType<import("./package-vault-access.mjs").createPackageVaultAccess>} vaultAccess
 * @param {{ autoGenerate?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function resolveHdcPasswordForSystem(systemId, vaultAccess, opts = {}) {
  const sid = systemId.trim();
  const vaultKey = hdcPasswordVaultKeyForSystem(sid);
  let pending = passwordCacheBySystem.get(vaultKey);
  if (!pending) {
    pending = (async () => {
      await vaultAccess.unlock({});
      const existing = String(
        await vaultAccess.getSecret(vaultKey, { optional: true }),
      ).trim();
      if (existing) {
        return existing;
      }
      if (opts.autoGenerate === false) {
        throw new Error(`${vaultKey} is not set`);
      }
      const generated = generateHdcPassword();
      await vaultAccess.setSecret(vaultKey, generated);
      return generated;
    })();
    passwordCacheBySystem.set(vaultKey, pending);
  }
  return pending;
}

/**
 * @typedef {object} HdcUserSshKeysResult
 * @property {boolean} ok
 * @property {boolean} skipped
 * @property {number} [installed]
 * @property {string} message
 */

/**
 * @typedef {object} HdcUserEnsureResult
 * @property {boolean} ok
 * @property {boolean} skipped
 * @property {string} [username]
 * @property {string} [vault_key]
 * @property {string} message
 * @property {HdcUserSshKeysResult} [ssh_keys]
 */

/**
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {ReturnType<import("./package-vault-access.mjs").createPackageVaultAccess>} [opts.vaultAccess]
 * @param {Record<string, unknown>} [opts.deployment]
 * @param {string} [opts.systemId]
 * @returns {Promise<HdcUserEnsureResult>}
 */
export async function ensureHdcUser({ exec, log, flags, vaultAccess, deployment, systemId }) {
  if (hdcUserSkippedByFlags(flags)) {
    log.info(`${exec.label}: hdc automation user skipped (--skip-hdc-user)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  const sid = systemId ?? systemIdFromDeployment(deployment);
  if (!sid) {
    const msg = "missing system_id on deployment for hdc user vault key";
    if (log.warn) log.warn(`${exec.label}: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }

  if (!vaultAccess) {
    const msg = "vaultAccess required for hdc user ensure";
    if (log.warn) log.warn(`${exec.label}: ${msg}`);
    return { ok: false, skipped: false, username: HDC_AUTOMATION_USERNAME, message: msg };
  }

  const vaultKey = hdcPasswordVaultKeyForSystem(sid);
  let password;
  try {
    password = await resolveHdcPasswordForSystem(sid, vaultAccess, { autoGenerate: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: ${msg}`);
    return {
      ok: false,
      skipped: false,
      username: HDC_AUTOMATION_USERNAME,
      vault_key: vaultKey,
      message: msg,
    };
  }

  const pwB64 = Buffer.from(password, "utf8").toString("base64");
  const remote = remoteEnsureHdcAutomationUserBash(pwB64);

  try {
    log.info(`${exec.label}: ensuring hdc automation user (${vaultKey})`);
    const r = exec.run(remote, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }

    const sshKeys = ensureHdcUserSshKeys({ exec, log, flags, username: HDC_AUTOMATION_USERNAME });
    return {
      ok: sshKeys.ok,
      skipped: false,
      username: HDC_AUTOMATION_USERNAME,
      vault_key: vaultKey,
      message: sshKeys.ok ? "ensured" : "user ensured but SSH keys failed",
      ssh_keys: sshKeys,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: hdc user ensure failed: ${msg}`);
    return {
      ok: false,
      skipped: false,
      username: HDC_AUTOMATION_USERNAME,
      vault_key: vaultKey,
      message: msg,
    };
  }
}

/**
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {string} opts.username
 * @returns {HdcUserSshKeysResult}
 */
export function ensureHdcUserSshKeys({ exec, log, flags, username }) {
  if (hdcUserSshKeysSkippedByFlags(flags)) {
    log.info(`${exec.label}: hdc user SSH keys skipped (--skip-hdc-ssh-keys)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  const { publicKeyLines } = discoverLocalSshMaterial();
  if (!publicKeyLines.length) {
    const msg = "no local ~/.ssh public keys found";
    if (log.warn) log.warn(`${exec.label}: ${msg}`);
    return { ok: false, skipped: false, installed: 0, message: msg };
  }

  const keyLinesB64 = publicKeyLines.map((line) => Buffer.from(line, "utf8").toString("base64"));
  let remote;
  try {
    remote = remoteInstallAuthorizedKeysForUserBash(username, keyLinesB64);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: ${msg}`);
    return { ok: false, skipped: false, installed: 0, message: msg };
  }

  try {
    log.info(
      `${exec.label}: installing ${publicKeyLines.length} SSH public key line(s) for ${username}`,
    );
    const r = exec.run(remote, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    return {
      ok: true,
      skipped: false,
      installed: publicKeyLines.length,
      message: "installed",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: hdc user SSH keys failed: ${msg}`);
    return { ok: false, skipped: false, installed: 0, message: msg };
  }
}
