import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readVault, writeVault } from "../vault.mjs";
import { hdcPrivateRoot } from "./private-repo.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";

/** Filename prefixes for backup artifacts (retention prunes per prefix). */
export const VAULT_BACKUP_PREFIX = "hdc-vault-";
export const BOOTSTRAP_BACKUP_PREFIX = "hdc-bootstrap-";

const DEFAULT_RETAIN = 30;
const CLUMP_TIER_DIRS = ["clients", "infrastructure", "services"];

/**
 * @typedef {object} ParsedSecretsBackupArgv
 * @property {string[]} dests
 * @property {number} retain
 * @property {boolean} dryRun
 */

/**
 * Split HDC_VAULT_BACKUP_DIRS on `;` (Windows-friendly; paths may contain drive colons).
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function splitBackupDirs(raw) {
  return String(raw ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} argv Arguments after `secrets backup`.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ParsedSecretsBackupArgv}
 */
export function parseSecretsBackupArgv(argv, env = process.env) {
  const dryRun = argv.includes("--dry-run");
  /** @type {string[]} */
  const dests = [];
  let retain = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dest" && argv[i + 1]) {
      dests.push(argv[++i]);
      continue;
    }
    if (argv[i] === "--retain" && argv[i + 1]) {
      retain = Number.parseInt(argv[++i], 10);
      continue;
    }
  }
  if (dests.length === 0) {
    dests.push(...splitBackupDirs(env.HDC_VAULT_BACKUP_DIRS));
  }
  if (!Number.isInteger(retain) || retain <= 0) {
    const fromEnv = Number.parseInt(String(env.HDC_VAULT_BACKUP_RETAIN ?? ""), 10);
    retain = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_RETAIN;
  }
  return { dests, retain, dryRun };
}

/**
 * Filesystem-safe timestamp for backup filenames (sortable).
 * @param {Date} [now]
 * @returns {string}
 */
export function backupTimestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * Collect operator bootstrap files that live outside git (root `.env` plus every
 * clump `.env` under hdc and hdc-private). Keys are repo-labelled relative paths.
 *
 * @param {string} publicRoot hdc repo root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, string>}
 */
export function collectBootstrapEnvFiles(publicRoot, env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  const privateRoot = hdcPrivateRoot(publicRoot, env);
  /** @type {Array<[string, string]>} */
  const roots = [["hdc", publicRoot]];
  if (privateRoot) roots.push(["hdc-private", privateRoot]);

  for (const [label, root] of roots) {
    const rootEnv = join(root, ".env");
    if (existsSync(rootEnv)) {
      out[`${label}/.env`] = readFileSync(rootEnv, "utf8");
    }
    for (const tierDir of CLUMP_TIER_DIRS) {
      const tierPath = join(root, "clumps", tierDir);
      if (!existsSync(tierPath)) continue;
      /** @type {import("node:fs").Dirent[]} */
      let entries;
      try {
        entries = readdirSync(tierPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const envPath = join(tierPath, entry.name, ".env");
        if (existsSync(envPath)) {
          out[`${label}/clumps/${tierDir}/${entry.name}/.env`] = readFileSync(envPath, "utf8");
        }
      }
    }
  }
  return out;
}

/**
 * Delete backup files beyond the newest `retain` for a given prefix.
 * @param {string} dir
 * @param {string} prefix
 * @param {number} retain
 * @returns {string[]} deleted filenames
 */
export function pruneBackupFiles(dir, prefix, retain) {
  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const matching = names
    .filter((n) => n.startsWith(prefix) && n.endsWith(".enc"))
    .sort()
    .reverse();
  /** @type {string[]} */
  const deleted = [];
  for (const name of matching.slice(retain)) {
    try {
      unlinkSync(join(dir, name));
      deleted.push(name);
    } catch {
      // best-effort prune
    }
  }
  return deleted;
}

/**
 * @typedef {object} SecretsBackupDestResult
 * @property {string} dest
 * @property {boolean} ok
 * @property {string} [vaultFile]
 * @property {string} [bootstrapFile]
 * @property {string[]} pruned
 * @property {string} [error]
 */

/**
 * @typedef {object} SecretsBackupResult
 * @property {boolean} ok
 * @property {boolean} dryRun
 * @property {string[]} bootstrapLabels
 * @property {SecretsBackupDestResult[]} destinations
 */

/**
 * @typedef {object} SecretsBackupOptions
 * @property {string} vaultPath Absolute path to vault.enc
 * @property {string} passphrase Local vault passphrase (encrypts the bootstrap bundle)
 * @property {string} publicRoot hdc repo root
 * @property {NodeJS.ProcessEnv} env
 * @property {string[]} dests
 * @property {number} retain
 * @property {boolean} [dryRun]
 * @property {(...args: unknown[]) => void} log
 * @property {(...args: unknown[]) => void} warn
 * @property {Date} [now]
 */

/**
 * Copy the encrypted vault plus an encrypted bundle of bootstrap `.env` files to
 * each destination directory, then prune old backups per prefix.
 *
 * @param {SecretsBackupOptions} opts
 * @returns {SecretsBackupResult}
 */
export function runSecretsBackup(opts) {
  const { vaultPath, passphrase, publicRoot, env, dests, retain, log, warn } = opts;
  const dryRun = opts.dryRun === true;
  const ts = backupTimestamp(opts.now);

  if (dests.length === 0) {
    throw new Error(
      "secrets backup: no destination (use --dest <dir> or set HDC_VAULT_BACKUP_DIRS)",
    );
  }

  const bootstrap = collectBootstrapEnvFiles(publicRoot, env);
  const bootstrapLabels = Object.keys(bootstrap).sort();
  const hasVault = existsSync(vaultPath);
  if (!hasVault) {
    warn(`secrets backup: no vault at ${vaultPath}; backing up bootstrap files only`);
  }

  /** @type {SecretsBackupDestResult[]} */
  const destinations = [];
  let ok = true;

  for (const destRaw of dests) {
    const dest = resolve(destRaw);
    const vaultFile = join(dest, `${VAULT_BACKUP_PREFIX}${ts}.enc`);
    const bootstrapFile = join(dest, `${BOOTSTRAP_BACKUP_PREFIX}${ts}.enc`);

    if (dryRun) {
      if (hasVault) log(`[dry-run] would copy ${vaultPath} -> ${vaultFile}`);
      if (bootstrapLabels.length) {
        log(
          `[dry-run] would write ${bootstrapFile} (${bootstrapLabels.length} bootstrap file(s))`,
        );
      }
      destinations.push({ dest, ok: true, pruned: [] });
      continue;
    }

    try {
      mkdirSync(dest, { recursive: true });
      /** @type {SecretsBackupDestResult} */
      const result = { dest, ok: true, pruned: [] };
      if (hasVault) {
        copyFileSync(vaultPath, vaultFile);
        result.vaultFile = vaultFile;
      }
      if (bootstrapLabels.length) {
        writeVault(bootstrapFile, passphrase, bootstrap);
        result.bootstrapFile = bootstrapFile;
      }
      result.pruned = [
        ...pruneBackupFiles(dest, VAULT_BACKUP_PREFIX, retain),
        ...pruneBackupFiles(dest, BOOTSTRAP_BACKUP_PREFIX, retain),
      ];
      destinations.push(result);
      log(
        `secrets backup: ${dest} (vault: ${result.vaultFile ? "yes" : "no"}, bootstrap: ${
          result.bootstrapFile ? bootstrapLabels.length : 0
        } file(s), pruned: ${result.pruned.length})`,
      );
    } catch (e) {
      ok = false;
      const msg = /** @type {Error} */ (e).message || String(e);
      destinations.push({ dest, ok: false, pruned: [], error: msg });
      warn(`secrets backup: ${dest} failed: ${msg}`);
    }
  }

  return { ok, dryRun, bootstrapLabels, destinations };
}

/**
 * Unlock the LOCAL vault passphrase regardless of the active secret backend
 * (backup/restore need the passphrase itself, not backend secrets).
 *
 * @param {import("./vault-access.mjs").VaultAccessDeps & { defaultVaultPath: () => string }} deps
 * @returns {Promise<string>}
 */
export async function unlockLocalVaultPassphrase(deps) {
  const localAccess = createVaultAccess({
    ...vaultDepsFromCli(deps),
    env: { ...deps.env, HDC_SECRET_BACKEND: "local" },
  });
  if (existsSync(deps.defaultVaultPath())) {
    const pass = await localAccess.unlock({ createIfMissing: false });
    if (pass) return pass;
  }
  const envPass = String(deps.env.HDC_VAULT_PASSPHRASE ?? "").trim();
  if (envPass) return envPass;
  const p = await deps.readLineQuestion("Vault passphrase: ", { mask: true });
  if (!p) throw new Error("empty vault passphrase");
  return p;
}

/**
 * @param {string} label
 * @returns {string} label validated as a safe relative path
 */
function safeBundleRelPath(label) {
  const rel = String(label).replace(/\\/g, "/");
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.split("/").includes("..")) {
    throw new Error(`secrets restore-bootstrap: unsafe path in bundle: ${label}`);
  }
  return rel;
}

/**
 * Decrypt a bootstrap bundle and write each contained file under `outDir`.
 *
 * @param {object} opts
 * @param {string} opts.file Bundle path (written by {@link runSecretsBackup})
 * @param {string} opts.passphrase
 * @param {string} opts.outDir
 * @param {boolean} [opts.force]
 * @returns {{ written: string[] }}
 */
export function restoreBootstrapBundle(opts) {
  const { file, passphrase, outDir } = opts;
  const force = opts.force === true;
  const bundle = readVault(file, passphrase);
  const entries = Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    throw new Error(`secrets restore-bootstrap: empty bundle: ${file}`);
  }
  /** @type {Array<[string, string, string]>} */
  const planned = [];
  for (const [label, contents] of entries) {
    const rel = safeBundleRelPath(label);
    const target = join(resolve(outDir), rel);
    if (!force && existsSync(target)) {
      throw new Error(`secrets restore-bootstrap: output exists (use --force): ${target}`);
    }
    planned.push([label, target, contents]);
  }
  /** @type {string[]} */
  const written = [];
  for (const [, target, contents] of planned) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, { encoding: "utf8", mode: 0o600 });
    written.push(target);
  }
  return { written };
}
