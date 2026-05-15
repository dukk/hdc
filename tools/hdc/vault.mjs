import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VAULT_VERSION = 1;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

/** @returns {string} */
export function defaultVaultPath() {
  return join(homedir(), ".hdc", "vault.enc");
}

/**
 * @param {string} vaultPath
 * @param {string} passphrase
 * @returns {Record<string, string>}
 */
export function readVault(vaultPath, passphrase) {
  if (!existsSync(vaultPath)) return {};
  const raw = JSON.parse(readFileSync(vaultPath, "utf8"));
  if (raw.v !== VAULT_VERSION) {
    throw new Error(`unsupported vault format v=${raw.v}`);
  }
  const salt = Buffer.from(raw.salt, "base64");
  const iv = Buffer.from(raw.iv, "base64");
  const tag = Buffer.from(raw.tag, "base64");
  const enc = Buffer.from(raw.data, "base64");
  const key = scryptSync(passphrase, salt, KEY_LEN, SCRYPT);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
  const parsed = JSON.parse(plain);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("vault payload must be a JSON object");
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * @param {string} vaultPath
 * @param {string} passphrase
 * @param {Record<string, string>} secrets
 */
export function writeVault(vaultPath, passphrase, secrets) {
  const dir = join(vaultPath, "..");
  mkdirSync(dir, { recursive: true });
  const salt = randomBytes(16);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(passphrase, salt, KEY_LEN, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(secrets), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const envelope = {
    v: VAULT_VERSION,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: body.toString("base64"),
  };
  writeFileSync(vaultPath, JSON.stringify(envelope, null, 0) + "\n", {
    mode: 0o600,
  });
}

/**
 * Merge vault entries into `process.env` (does not override existing vars).
 * The CLI no longer calls this at startup; scripts should use `createVaultAccess` /
 * `getSecret` from `tools/hdc/lib/vault-access.mjs` for interactive unlock and per-key secrets.
 * @param {string} vaultPath
 * @param {string} [passphrase]
 */
export function applyVaultToEnv(vaultPath, passphrase) {
  if (!passphrase || !existsSync(vaultPath)) return;
  try {
    const secrets = readVault(vaultPath, passphrase);
    for (const [k, v] of Object.entries(secrets)) {
      if (process.env[k] === undefined) {
        process.env[k] = v;
      }
    }
  } catch (e) {
    console.warn(`warning: could not load secrets vault (${vaultPath}):`, e);
  }
}
