import { readVault, writeVault } from "../vault.mjs";
import { CliExit } from "./cli-exit.mjs";
import { isLocalOnlyVaultKey, isAutoSecretBackend, resolveSecretBackendMode } from "./secret-backend.mjs";
import {
  bwDeleteItem,
  bwGetPassword,
  bwItemExistsInOrg,
  bwListItemNames,
  bwReadOrgSecrets,
  bwSetPassword,
  ensureBwUnlocked,
  getProcessBwSession,
  vaultwardenCliDepsFromCli,
} from "./vaultwarden-cli.mjs";

/** Process-wide vault passphrase cache (one prompt per hdc command). */
/** @type {Map<string, string>} */
const processPassphraseByVaultPath = new Map();

/** @internal Test helper */
export function clearVaultPassphraseProcessCache() {
  processPassphraseByVaultPath.clear();
}

/**
 * @typedef {object} VaultAccessDeps
 * @property {NodeJS.ProcessEnv} env
 * @property {(...args: unknown[]) => void} log
 * @property {(...args: unknown[]) => void} error
 * @property {(...args: unknown[]) => void} warn
 * @property {() => string} defaultVaultPath
 * @property {typeof import("node:fs").existsSync} existsSync
 * @property {(q: string, opts?: { mask?: boolean }) => Promise<string>} readLineQuestion
 * @property {typeof import("node:child_process").spawnSync} [spawnSync]
 */

/**
 * @typedef {object} UnlockOptions
 * @property {boolean} [createIfMissing] When the vault file is missing, create it after passphrase (default true).
 */

/**
 * @typedef {object} GetSecretOptions
 * @property {string} [promptLabel]
 * @property {boolean} [allowEmpty]
 * @property {boolean} [optional] When true, return "" if the secret is missing instead of prompting.
 * @property {(value: string) => boolean | Promise<boolean>} [verify] If provided, must return true before saving.
 */

/**
 * @param {VaultAccessDeps} deps
 */
export function createVaultAccess(deps) {
  /** @type {string | null} */
  let cachedPassphrase = null;

  /** @type {Map<string, string>} Per-process vaultwarden secret cache (key → value). */
  const vaultwardenSecretCache = new Map();

  const vwCli = vaultwardenCliDepsFromCli(deps, deps.spawnSync);

  function vaultPath() {
    return deps.defaultVaultPath();
  }

  /**
   * @returns {"local" | "vaultwarden"}
   */
  function backendMode() {
    return resolveSecretBackendMode(deps.env);
  }

  /**
   * @param {string} pass
   */
  function canDecrypt(pass) {
    try {
      readVault(vaultPath(), pass);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {UnlockOptions} [opts]
   * @returns {Promise<string | null>} `null` only if the vault file is missing and `createIfMissing` is false.
   */
  async function unlockLocal(opts = {}) {
    const createIfMissing = opts.createIfMissing !== false;
    if (cachedPassphrase !== null) return cachedPassphrase;

    const file = vaultPath();
    const envPass = String(deps.env.HDC_VAULT_PASSPHRASE ?? "").trim();
    const processCached = processPassphraseByVaultPath.get(file);
    if (processCached !== undefined && canDecrypt(processCached) && !envPass) {
      cachedPassphrase = processCached;
      return cachedPassphrase;
    }

    if (deps.existsSync(file)) {
      if (envPass && canDecrypt(envPass)) {
        cachedPassphrase = envPass;
        processPassphraseByVaultPath.set(file, cachedPassphrase);
        return cachedPassphrase;
      }
      if (envPass) {
        deps.warn(
          "HDC_VAULT_PASSPHRASE is set but does not decrypt the vault; enter the vault passphrase interactively.",
        );
      }
      for (;;) {
        const p = await deps.readLineQuestion("Vault passphrase: ", { mask: true });
        if (!p) {
          deps.error("Aborted (empty vault passphrase).");
          throw new CliExit(1);
        }
        if (canDecrypt(p)) {
          cachedPassphrase = p;
          processPassphraseByVaultPath.set(file, cachedPassphrase);
          return cachedPassphrase;
        }
        deps.warn("Could not decrypt the vault; try again.");
      }
    }

    if (!createIfMissing) {
      return null;
    }

    if (envPass) {
      writeVault(file, envPass, {});
      cachedPassphrase = envPass;
      processPassphraseByVaultPath.set(file, cachedPassphrase);
      deps.log(`created vault at ${file} (passphrase from HDC_VAULT_PASSPHRASE)`);
      return cachedPassphrase;
    }

    const p1 = await deps.readLineQuestion("Vault file does not exist yet. Choose a vault passphrase: ", {
      mask: true,
    });
    if (!p1) {
      deps.error("Aborted (empty passphrase).");
      throw new CliExit(1);
    }
    const p2 = await deps.readLineQuestion("Confirm vault passphrase: ", { mask: true });
    if (p1 !== p2) {
      deps.error("Passphrases do not match.");
      throw new CliExit(1);
    }
    writeVault(file, p1, {});
    cachedPassphrase = p1;
    processPassphraseByVaultPath.set(file, cachedPassphrase);
    deps.log(`created vault at ${file}`);
    return cachedPassphrase;
  }

  /**
   * Unlock secrets for the active backend (Vaultwarden session or local vault).
   *
   * @param {UnlockOptions} [opts]
   * @returns {Promise<string | null>}
   */
  async function unlock(opts = {}) {
    if (backendMode() === "vaultwarden") {
      await unlockVaultwarden();
      return null;
    }
    return unlockLocal(opts);
  }

  /**
   * @param {UnlockOptions} [unlockOpts]
   * @returns {Promise<Record<string, string> | null>} `null` if the vault is missing and was not created (`createIfMissing: false`).
   */
  async function readLocalSecrets(unlockOpts = {}) {
    const pass = await unlockLocal(unlockOpts);
    if (pass === null) return null;
    const f = vaultPath();
    if (!deps.existsSync(f)) return {};
    return readVault(f, pass);
  }

  /**
   * @param {Record<string, string>} secrets
   */
  function seedVaultwardenCache(secrets) {
    for (const [key, value] of Object.entries(secrets)) {
      if (typeof value === "string" && value.length > 0) {
        vaultwardenSecretCache.set(key, value);
      }
    }
  }

  /**
   * @param {UnlockOptions} [unlockOpts]
   * @returns {Promise<Record<string, string> | null>}
   */
  async function readSecrets(unlockOpts = {}) {
    const mode = backendMode();
    if (mode === "vaultwarden") {
      try {
        const session = await ensureBwUnlocked(
          vwCli,
          async (key) => {
            const data = await readLocalSecrets({ createIfMissing: false });
            if (data === null) return null;
            const v = data[key];
            return typeof v === "string" && v.length > 0 ? v : null;
          },
          async (key, value) => {
            await setLocalSecret(key, value);
          },
        );
        const out = bwReadOrgSecrets(vwCli, session);
        seedVaultwardenCache(out);
        const local = await readLocalSecrets(unlockOpts);
        if (local) {
          for (const [k, v] of Object.entries(local)) {
            if (isLocalOnlyVaultKey(k)) out[k] = v;
          }
        }
        return out;
      } catch (e) {
        if (isAutoSecretBackend(deps.env)) {
          deps.warn(`Vaultwarden backend unavailable (${/** @type {Error} */ (e).message}); using local vault.`);
          return readLocalSecrets(unlockOpts);
        }
        throw e;
      }
    }
    return readLocalSecrets(unlockOpts);
  }

  /**
   * @param {Record<string, string>} secrets
   */
  async function writeSecrets(secrets) {
    const mode = backendMode();
    if (mode === "vaultwarden") {
      const session = await ensureBwUnlocked(
        vwCli,
        async (key) => {
          const data = await readLocalSecrets({ createIfMissing: false });
          if (data === null) return null;
          const v = data[key];
          return typeof v === "string" && v.length > 0 ? v : null;
        },
        async (key, value) => {
          await setLocalSecret(key, value);
        },
      );
      for (const [key, value] of Object.entries(secrets)) {
        if (isLocalOnlyVaultKey(key)) {
          await setLocalSecret(key, value);
        } else {
          bwSetPassword(vwCli, session, key, value);
        }
      }
      return;
    }
    const pass = await unlockLocal();
    writeVault(vaultPath(), pass, secrets);
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  async function setLocalSecret(key, value) {
    let data = await readLocalSecrets({});
    if (data === null) data = {};
    data[key] = value;
    const pass = await unlockLocal();
    writeVault(vaultPath(), pass, data);
  }

  /**
   * Return stored secret or prompt, optionally verify, then persist.
   * @param {string} key
   * @param {GetSecretOptions} [options]
   * @returns {Promise<string>}
   */
  /**
   * @param {string} key
   */
  function secretFromEnv(key) {
    const v = deps.env[key];
    return typeof v === "string" ? v.trim() : "";
  }

  async function getSecretLocal(key, options = {}) {
    const { promptLabel, verify, allowEmpty = false, optional = false } = options;
    const fromEnv = secretFromEnv(key);
    if (fromEnv) return fromEnv;

    let data = await readLocalSecrets({});
    if (data === null) data = {};
    const cur = data[key];
    if (typeof cur === "string" && cur.length > 0) return cur;

    if (optional) return "";

    const label = promptLabel ?? `Secret value for ${key}`;
    for (;;) {
      const value = await deps.readLineQuestion(`${label}: `, { mask: true });
      if (!value && !allowEmpty) {
        deps.error("Empty value; try again or Ctrl+C to abort.");
        continue;
      }
      if (verify) {
        const ok = await verify(value);
        if (!ok) {
          deps.warn("Verification failed; try again.");
          continue;
        }
      }
      data = await readLocalSecrets({});
      if (data === null) data = {};
      data[key] = value;
      const pass = await unlockLocal();
      writeVault(vaultPath(), pass, data);
      return value;
    }
  }

  /**
   * @param {string} key
   * @param {GetSecretOptions} [options]
   * @returns {Promise<string>}
   */
  async function getSecret(key, options = {}) {
    const { promptLabel, verify, allowEmpty = false, optional = false } = options;
    const fromEnv = secretFromEnv(key);
    if (fromEnv) return fromEnv;

    const useLocalOnly = isLocalOnlyVaultKey(key) || backendMode() === "local";

    if (useLocalOnly) {
      return getSecretLocal(key, options);
    }

    const cached = vaultwardenSecretCache.get(key);
    if (typeof cached === "string" && cached.length > 0) return cached;

    try {
      const session = await ensureBwUnlocked(
        vwCli,
        async (k) => {
          const data = await readLocalSecrets({ createIfMissing: false });
          if (data === null) return null;
          const v = data[k];
          return typeof v === "string" && v.length > 0 ? v : null;
        },
        async (k, value) => {
          await setLocalSecret(k, value);
        },
      );
      const cur = bwGetPassword(vwCli, session, key);
      if (typeof cur === "string" && cur.length > 0) {
        vaultwardenSecretCache.set(key, cur);
        return cur;
      }

      if (isAutoSecretBackend(deps.env)) {
        const localVal = await getSecretLocal(key, { ...options, optional: true });
        if (localVal) {
          if (bwItemExistsInOrg(vwCli, session, key)) {
            deps.warn(
              `Vaultwarden item ${key} exists in the HDC collection but has no password set; using local vault copy.`,
            );
          }
          return localVal;
        }
      }

      if (optional) return "";

      const label = promptLabel ?? `Secret value for ${key}`;
      for (;;) {
        const value = await deps.readLineQuestion(`${label}: `, { mask: true });
        if (!value && !allowEmpty) {
          deps.error("Empty value; try again or Ctrl+C to abort.");
          continue;
        }
        if (verify) {
          const ok = await verify(value);
          if (!ok) {
            deps.warn("Verification failed; try again.");
            continue;
          }
        }
        if (value) {
          bwSetPassword(vwCli, session, key, value);
          vaultwardenSecretCache.set(key, value);
        }
        return value;
      }
    } catch (e) {
      if (isAutoSecretBackend(deps.env)) {
        deps.warn(`Vaultwarden backend unavailable (${/** @type {Error} */ (e).message}); using local vault for ${key}.`);
        return getSecretLocal(key, options);
      }
      throw e;
    }
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  async function setSecret(key, value) {
    if (isLocalOnlyVaultKey(key) || backendMode() === "local") {
      await setLocalSecret(key, value);
      return;
    }
    try {
      const session = await ensureBwUnlocked(
        vwCli,
        async (k) => {
          const data = await readLocalSecrets({ createIfMissing: false });
          if (data === null) return null;
          const v = data[k];
          return typeof v === "string" && v.length > 0 ? v : null;
        },
        async (k, val) => {
          await setLocalSecret(k, val);
        },
      );
      bwSetPassword(vwCli, session, key, value);
      vaultwardenSecretCache.set(key, value);
      await setLocalSecret(key, value);
    } catch (e) {
      if (isAutoSecretBackend(deps.env)) {
        deps.warn(`Vaultwarden backend unavailable (${/** @type {Error} */ (e).message}); saving ${key} to local vault.`);
        await setLocalSecret(key, value);
      } else {
        throw e;
      }
    }
  }

  /**
   * @param {string} key
   */
  async function deleteSecret(key) {
    if (isLocalOnlyVaultKey(key) || backendMode() === "local") {
      let data = await readLocalSecrets({ createIfMissing: false });
      if (data === null) return false;
      if (!(key in data)) return false;
      delete data[key];
      const pass = await unlockLocal();
      writeVault(vaultPath(), pass, data);
      return true;
    }
    try {
      const session = await ensureBwUnlocked(
        vwCli,
        async (k) => {
          const data = await readLocalSecrets({ createIfMissing: false });
          if (data === null) return null;
          const v = data[k];
          return typeof v === "string" && v.length > 0 ? v : null;
        },
        async (k, val) => {
          await setLocalSecret(k, val);
        },
      );
      const deleted = bwDeleteItem(vwCli, session, key);
      if (deleted) vaultwardenSecretCache.delete(key);
      return deleted;
    } catch (e) {
      if (isAutoSecretBackend(deps.env)) {
        let data = await readLocalSecrets({ createIfMissing: false });
        if (data === null || !(key in data)) return false;
        delete data[key];
        const pass = await unlockLocal();
        writeVault(vaultPath(), pass, data);
        return true;
      }
      throw e;
    }
  }

  /**
   * Pre-unlock Vaultwarden when the secret backend is active.
   */
  async function unlockVaultwarden() {
    if (backendMode() === "local") {
      deps.warn("HDC_SECRET_BACKEND is local; Vaultwarden unlock skipped.");
      return;
    }
    const hadSession = getProcessBwSession() !== null;
    await ensureBwUnlocked(
      vwCli,
      async (k) => {
        const data = await readLocalSecrets({ createIfMissing: false });
        if (data === null) return null;
        const v = data[k];
        return typeof v === "string" && v.length > 0 ? v : null;
      },
      async (k, value) => {
        await setLocalSecret(k, value);
      },
    );
    if (!hadSession) {
      deps.log("[hdc] vaultwarden: vault unlocked.");
    }
  }

  /**
   * @returns {Promise<{ local: string[]; vaultwarden: string[]; mode: "local" | "vaultwarden" }>}
   */
  async function listSecretKeys() {
    const localData = await readLocalSecrets({ createIfMissing: false });
    const local = localData ? Object.keys(localData).sort() : [];
    const mode = backendMode();
    if (mode === "local") {
      return { local, vaultwarden: [], mode };
    }
    try {
      const session = await ensureBwUnlocked(
        vwCli,
        async (k) => {
          const data = await readLocalSecrets({ createIfMissing: false });
          if (data === null) return null;
          const v = data[k];
          return typeof v === "string" && v.length > 0 ? v : null;
        },
        async (k, value) => {
          await setLocalSecret(k, value);
        },
      );
      const vaultwarden = bwListItemNames(vwCli, session);
      return { local, vaultwarden, mode };
    } catch {
      return { local, vaultwarden: [], mode: "local" };
    }
  }

  return {
    unlock,
    readLocalSecrets,
    readSecrets,
    writeSecrets,
    getSecret,
    setSecret,
    deleteSecret,
    unlockVaultwarden,
    listSecretKeys,
    canDecrypt,
    vaultPath,
  };
}

/**
 * Pick fields needed by {@link createVaultAccess} from a CLI-like deps object.
 * @param {Pick<VaultAccessDeps, "env" | "log" | "error" | "warn" | "defaultVaultPath" | "existsSync" | "readLineQuestion" | "spawnSync">} cliLike
 */
export function vaultDepsFromCli(cliLike) {
  return {
    env: cliLike.env,
    log: cliLike.log,
    error: cliLike.error,
    warn: cliLike.warn,
    defaultVaultPath: cliLike.defaultVaultPath,
    existsSync: cliLike.existsSync,
    readLineQuestion: cliLike.readLineQuestion,
    spawnSync: cliLike.spawnSync,
  };
}
