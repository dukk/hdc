import { isLocalOnlyVaultKey } from "./secret-backend.mjs";
import {
  bwItemExistsInOrg,
  bwItemHasSecret,
  bwSetPassword,
  ensureBwUnlocked,
  resolveBwOrgContext,
} from "./vaultwarden-cli.mjs";
import { resolveUrisForSecretKey } from "./vaultwarden-sync-uris.mjs";

/**
 * @typedef {object} PushLocalSecretsOptions
 * @property {boolean} [dryRun]
 * @property {boolean} [skipExisting]
 * @property {boolean} [force]
 */

/**
 * @typedef {object} PushLocalSecretsResult
 * @property {number} pushed
 * @property {number} updated
 * @property {number} skipped
 * @property {string[]} skippedKeys
 * @property {string[]} pushedKeys
 * @property {string[]} errorKeys
 */

/**
 * Push non-bootstrap secrets from the local hdc vault into the Vaultwarden HDC organization.
 *
 * @param {ReturnType<import("./vault-access.mjs").createVaultAccess>} access
 * @param {ReturnType<import("./vaultwarden-cli.mjs").vaultwardenCliDepsFromCli>} vwCli
 * @param {PushLocalSecretsOptions} [options]
 * @returns {Promise<PushLocalSecretsResult>}
 */
export async function pushLocalSecretsToVaultwarden(access, vwCli, options = {}) {
  const dryRun = options.dryRun === true;
  const skipExisting = options.skipExisting === true;
  const force = options.force === true;

  const local = await access.readLocalSecrets({ createIfMissing: false });
  if (local === null) {
    throw new Error("no local vault found (run secrets init first)");
  }

  const session = await ensureBwUnlocked(
    vwCli,
    async (key) => {
      const data = await access.readLocalSecrets({ createIfMissing: false });
      if (data === null) return null;
      const v = data[key];
      return typeof v === "string" && v.length > 0 ? v : null;
    },
    async (key, value) => {
      await access.setSecret(key, value);
    },
  );

  const { organizationId, collectionId } = resolveBwOrgContext(vwCli, session);
  vwCli.log(
    `[hdc] vaultwarden: pushing local secrets to organization ${organizationId} (collection ${collectionId})`,
  );

  /** @type {PushLocalSecretsResult} */
  const result = {
    pushed: 0,
    updated: 0,
    skipped: 0,
    skippedKeys: [],
    pushedKeys: [],
    errorKeys: [],
  };

  const keys = Object.keys(local).filter((k) => !isLocalOnlyVaultKey(k)).sort();
  if (keys.length === 0) {
    vwCli.log("[hdc] vaultwarden: no local secrets to push (bootstrap keys excluded)");
    return result;
  }

  for (const key of keys) {
    const value = local[key];
    if (typeof value !== "string" || value.length === 0) continue;

    const exists = bwItemExistsInOrg(vwCli, session, key);
    const hasSecret = exists && bwItemHasSecret(vwCli, session, key);
    if (skipExisting && !force && hasSecret) {
      result.skipped += 1;
      result.skippedKeys.push(key);
      vwCli.log(`[hdc] vaultwarden: skip ${key} (already in organization)`);
      continue;
    }

    if (dryRun) {
      result.pushed += 1;
      result.pushedKeys.push(key);
      vwCli.log(`[hdc] vaultwarden: [dry-run] would push ${key}`);
      continue;
    }

    try {
      const uris = await resolveUrisForSecretKey(key, vwCli.env);
      bwSetPassword(vwCli, session, key, value, uris ? { uris } : {});
      if (exists) {
        result.updated += 1;
        vwCli.log(`[hdc] vaultwarden: updated ${key}`);
      } else {
        result.pushed += 1;
        vwCli.log(`[hdc] vaultwarden: pushed ${key}`);
      }
      result.pushedKeys.push(key);
    } catch (e) {
      result.errorKeys.push(key);
      const msg = e instanceof Error ? e.message : String(e);
      vwCli.warn(`[hdc] vaultwarden: failed to push ${key}: ${msg}`);
    }
  }

  return result;
}

/**
 * @param {string[]} argv Arguments after `secrets push`.
 * @returns {{ dryRun: boolean; skipExisting: boolean; force: boolean }}
 */
export function parseSecretsPushArgv(argv) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const skipExisting = !force;
  return { dryRun, skipExisting, force };
}
