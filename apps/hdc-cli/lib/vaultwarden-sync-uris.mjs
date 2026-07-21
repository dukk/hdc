import { repoRoot } from "../paths.mjs";
import {
  bwGetLoginUris,
  bwListItemNames,
  bwUpdateLoginUris,
  ensureBwUnlocked,
} from "./vaultwarden-cli.mjs";

/**
 * Lazy-load vault-key-uris (pulls hdc/clump/*) so MCP/agent images can import
 * vault-access without a clumps tree.
 * @returns {Promise<typeof import("./vault-key-uris.mjs")>}
 */
function loadVaultKeyUris() {
  return import("./vault-key-uris.mjs");
}

/**
 * @typedef {object} SyncVaultKeyUrisOptions
 * @property {boolean} [dryRun]
 * @property {boolean} [force]
 * @property {string} [keyFilter]
 * @property {string} [publicRoot]
 */

/**
 * @typedef {object} SyncVaultKeyUrisResult
 * @property {number} updated
 * @property {number} skipped
 * @property {number} unchanged
 * @property {string[]} updatedKeys
 * @property {string[]} skippedKeys
 * @property {string[]} unchangedKeys
 * @property {string[]} errorKeys
 */

/**
 * Sync HDC service website URIs onto Vaultwarden Login items.
 *
 * @param {ReturnType<import("./vault-access.mjs").createVaultAccess>} access
 * @param {ReturnType<import("./vaultwarden-cli.mjs").vaultwardenCliDepsFromCli>} vwCli
 * @param {SyncVaultKeyUrisOptions} [options]
 * @returns {Promise<SyncVaultKeyUrisResult>}
 */
export async function syncVaultKeyUris(access, vwCli, options = {}) {
  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const keyFilter = typeof options.keyFilter === "string" ? options.keyFilter.trim() : "";
  const publicRoot = options.publicRoot ?? repoRoot();

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

  const { buildAllVaultKeyUris, vaultKeyUrisEqual } = await loadVaultKeyUris();
  const uriMap = buildAllVaultKeyUris(publicRoot, vwCli.env);
  /** @type {string[]} */
  const itemNames = bwListItemNames(vwCli, session).filter((name) =>
    keyFilter ? name === keyFilter : true,
  );

  /** @type {SyncVaultKeyUrisResult} */
  const result = {
    updated: 0,
    skipped: 0,
    unchanged: 0,
    updatedKeys: [],
    skippedKeys: [],
    unchangedKeys: [],
    errorKeys: [],
  };

  if (itemNames.length === 0) {
    vwCli.log("[hdc] vaultwarden: no organization items to sync URIs for");
    return result;
  }

  vwCli.log(`[hdc] vaultwarden: syncing website URIs for ${itemNames.length} item(s)`);

  for (const key of itemNames) {
    const desired = uriMap.get(key);
    if (!desired || desired.length === 0) {
      result.skipped += 1;
      result.skippedKeys.push(key);
      vwCli.log(`[hdc] vaultwarden: skip ${key} (no HDC URL)`);
      continue;
    }

    let live = [];
    try {
      live = bwGetLoginUris(vwCli, session, key);
    } catch (e) {
      result.errorKeys.push(key);
      const msg = e instanceof Error ? e.message : String(e);
      vwCli.warn(`[hdc] vaultwarden: failed to read URIs for ${key}: ${msg}`);
      continue;
    }

    const needsUpdate = force || live.length === 0 || !vaultKeyUrisEqual(live, desired);
    if (!needsUpdate) {
      result.unchanged += 1;
      result.unchangedKeys.push(key);
      vwCli.log(`[hdc] vaultwarden: unchanged ${key}`);
      continue;
    }

    if (dryRun) {
      result.updated += 1;
      result.updatedKeys.push(key);
      vwCli.log(`[hdc] vaultwarden: [dry-run] would set ${key} URIs: ${desired.join(", ")}`);
      continue;
    }

    try {
      bwUpdateLoginUris(vwCli, session, key, desired);
      result.updated += 1;
      result.updatedKeys.push(key);
      vwCli.log(`[hdc] vaultwarden: updated ${key} URIs (${desired.length})`);
    } catch (e) {
      result.errorKeys.push(key);
      const msg = e instanceof Error ? e.message : String(e);
      vwCli.warn(`[hdc] vaultwarden: failed to update URIs for ${key}: ${msg}`);
    }
  }

  return result;
}

/**
 * @param {string[]} argv Arguments after `secrets sync-uris`.
 * @returns {{ dryRun: boolean; force: boolean; keyFilter: string }}
 */
export function parseSecretsSyncUrisArgv(argv) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  let keyFilter = "";
  const keyIdx = argv.indexOf("--key");
  if (keyIdx >= 0 && typeof argv[keyIdx + 1] === "string") {
    keyFilter = argv[keyIdx + 1].trim();
  }
  return { dryRun, force, keyFilter };
}

/**
 * Resolve website URIs for an env key (for secrets set/push).
 * Returns undefined when the clumps tree is unavailable (e.g. slim agent image).
 * @param {string} envKey
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string[] | undefined>}
 */
export async function resolveUrisForSecretKey(envKey, env = process.env) {
  try {
    const { buildAllVaultKeyUris } = await loadVaultKeyUris();
    const uris = buildAllVaultKeyUris(repoRoot(), env).get(envKey);
    return uris && uris.length > 0 ? uris : undefined;
  } catch {
    return undefined;
  }
}
