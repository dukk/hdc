import { readVault, writeVault } from "../vault.mjs";
import { CliExit } from "./cli-exit.mjs";

/**
 * @typedef {object} VaultAccessDeps
 * @property {NodeJS.ProcessEnv} env
 * @property {(...args: unknown[]) => void} log
 * @property {(...args: unknown[]) => void} error
 * @property {(...args: unknown[]) => void} warn
 * @property {() => string} defaultVaultPath
 * @property {typeof import("node:fs").existsSync} existsSync
 * @property {(q: string, opts?: { mask?: boolean }) => Promise<string>} readLineQuestion
 */

/**
 * @typedef {object} UnlockOptions
 * @property {boolean} [createIfMissing] When the vault file is missing, create it after passphrase (default true).
 */

/**
 * @typedef {object} GetSecretOptions
 * @property {string} [promptLabel]
 * @property {boolean} [allowEmpty]
 * @property {(value: string) => boolean | Promise<boolean>} [verify] If provided, must return true before saving.
 */

/**
 * @param {VaultAccessDeps} deps
 */
export function createVaultAccess(deps) {
  /** @type {string | null} */
  let cachedPassphrase = null;

  function vaultPath() {
    return deps.defaultVaultPath();
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
  async function unlock(opts = {}) {
    const createIfMissing = opts.createIfMissing !== false;
    if (cachedPassphrase !== null) return cachedPassphrase;

    const file = vaultPath();
    const envPass = String(deps.env.HDC_VAULT_PASSPHRASE ?? "").trim();

    if (deps.existsSync(file)) {
      if (envPass && canDecrypt(envPass)) {
        cachedPassphrase = envPass;
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
    deps.log(`created vault at ${file}`);
    return cachedPassphrase;
  }

  /**
   * @param {UnlockOptions} [unlockOpts]
   * @returns {Promise<Record<string, string> | null>} `null` if the vault is missing and was not created (`createIfMissing: false`).
   */
  async function readSecrets(unlockOpts = {}) {
    const pass = await unlock(unlockOpts);
    if (pass === null) return null;
    const f = vaultPath();
    if (!deps.existsSync(f)) return {};
    return readVault(f, pass);
  }

  /**
   * @param {Record<string, string>} secrets
   */
  async function writeSecrets(secrets) {
    const pass = await unlock();
    writeVault(vaultPath(), pass, secrets);
  }

  /**
   * Return stored secret or prompt, optionally verify, then persist.
   * @param {string} key
   * @param {GetSecretOptions} [options]
   * @returns {Promise<string>}
   */
  async function getSecret(key, options = {}) {
    const { promptLabel, verify, allowEmpty = false } = options;
    let data = await readSecrets({});
    if (data === null) data = {};
    const cur = data[key];
    if (typeof cur === "string" && cur.length > 0) return cur;

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
      data = await readSecrets({});
      if (data === null) data = {};
      data[key] = value;
      await writeSecrets(data);
      return value;
    }
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  async function setSecret(key, value) {
    let data = await readSecrets({});
    if (data === null) data = {};
    data[key] = value;
    await writeSecrets(data);
  }

  return { unlock, readSecrets, writeSecrets, getSecret, setSecret, canDecrypt, vaultPath };
}

/**
 * Pick fields needed by {@link createVaultAccess} from a CLI-like deps object.
 * @param {Pick<VaultAccessDeps, "env" | "log" | "error" | "warn" | "defaultVaultPath" | "existsSync" | "readLineQuestion">} cliLike
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
  };
}
