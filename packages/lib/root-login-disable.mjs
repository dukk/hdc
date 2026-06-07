import { env as processEnv } from "node:process";

import { flagGet } from "./parse-argv-flags.mjs";
import { resolveAdminUsername } from "./admin-user-ensure.mjs";
import { HDC_AUTOMATION_USERNAME } from "./hdc-user-ensure.mjs";

export const ROOT_SSH_DROPIN = "/etc/ssh/sshd_config.d/99-hdc-disable-root.conf";

/**
 * @param {string} adminUsername validated linux username
 * @returns {string}
 */
export function remoteDisableRootLoginBash(adminUsername) {
  const admin = adminUsername.replace(/[^a-z0-9_-]/g, "");
  return [
    "set -euo pipefail",
    `id -u ${HDC_AUTOMATION_USERNAME} >/dev/null`,
    `id -u ${admin} >/dev/null`,
    "install -d -m 755 /etc/ssh/sshd_config.d",
    `printf '%s\\n' 'PermitRootLogin no' > ${ROOT_SSH_DROPIN}`,
    "chmod 644 /etc/ssh/sshd_config.d/99-hdc-disable-root.conf",
    "passwd -l root",
    "if systemctl list-unit-files ssh.service >/dev/null 2>&1; then systemctl reload ssh; elif systemctl list-unit-files sshd.service >/dev/null 2>&1; then systemctl reload sshd; else service ssh reload; fi",
  ].join("; ");
}

/**
 * @param {Record<string, string>} [flags]
 * @returns {boolean}
 */
export function rootDisableSkippedByFlags(flags) {
  return flagGet(flags ?? {}, "skip-disable-root", "skip_disable_root") !== undefined;
}

/**
 * @typedef {object} RootLoginDisableResult
 * @property {boolean} ok
 * @property {boolean} skipped
 * @property {string} message
 */

/**
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {{ ok?: boolean; skipped?: boolean }} [opts.hdcUser]
 * @param {{ ok?: boolean; skipped?: boolean }} [opts.adminUser]
 * @returns {RootLoginDisableResult}
 */
export function ensureRootDisabled({ exec, log, flags, env, hdcUser, adminUser }) {
  if (rootDisableSkippedByFlags(flags)) {
    log.info(`${exec.label}: root login disable skipped (--skip-disable-root)`);
    return { ok: true, skipped: true, message: "skipped by flag" };
  }

  if (hdcUser?.skipped || adminUser?.skipped) {
    return { ok: true, skipped: true, message: "skipped (hdc or admin user skipped)" };
  }
  if (hdcUser?.ok === false || adminUser?.ok === false) {
    return { ok: false, skipped: false, message: "hdc or admin user not ensured" };
  }

  let adminUsername;
  try {
    adminUsername = resolveAdminUsername(env ?? processEnv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }

  const remote = remoteDisableRootLoginBash(adminUsername);
  try {
    log.info(`${exec.label}: disabling root SSH (hdc + ${adminUsername} present)`);
    const r = exec.run(remote, { capture: true });
    if (r.status !== 0) {
      const detail = `${r.stderr}${r.stdout}`.trim() || `exit ${r.status}`;
      throw new Error(detail);
    }
    return { ok: true, skipped: false, message: "root locked; PermitRootLogin no" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (log.warn) log.warn(`${exec.label}: root disable failed: ${msg}`);
    return { ok: false, skipped: false, message: msg };
  }
}
