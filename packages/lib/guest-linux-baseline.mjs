import { ensureAdminUser } from "./admin-user-ensure.mjs";
import { ensureClamav } from "./clamav-ensure.mjs";

/**
 * Guest maintain baseline: local admin user + ClamAV.
 *
 * @param {object} opts
 * @param {import("./clamav-ensure.mjs").ConfigureExec} opts.exec
 * @param {{ info: (msg: string) => void; warn?: (msg: string) => void }} opts.log
 * @param {Record<string, string>} [opts.flags]
 * @param {ReturnType<import("./package-vault-access.mjs").createPackageVaultAccess>} [opts.vaultAccess]
 * @param {NodeJS.ProcessEnv} [opts.env]
 */
export async function ensureGuestLinuxBaseline(opts) {
  const adminUser = await ensureAdminUser(opts);
  const clamav = await ensureClamav(opts);
  return {
    ok: adminUser.ok && clamav.ok,
    admin_user: adminUser,
    clamav,
  };
}
