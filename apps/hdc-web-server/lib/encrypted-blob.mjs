import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BLOB_VERSION = 1;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;
const IV_LEN = 12;

/**
 * @param {string} passphrase
 * @param {string} plaintext
 * @returns {{ v: number; salt: string; iv: string; tag: string; data: string }}
 */
export function encryptBlob(passphrase, plaintext) {
  const salt = randomBytes(16);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(passphrase, salt, KEY_LEN, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: BLOB_VERSION,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: body.toString("base64"),
  };
}

/**
 * @param {string} passphrase
 * @param {{ v?: number; salt: string; iv: string; tag: string; data: string }} envelope
 * @returns {string}
 */
export function decryptBlob(passphrase, envelope) {
  if (envelope.v !== BLOB_VERSION) {
    throw new Error(`unsupported encrypted blob format v=${envelope.v}`);
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const enc = Buffer.from(envelope.data, "base64");
  const key = scryptSync(passphrase, salt, KEY_LEN, SCRYPT);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * @param {string} filePath
 * @param {string} passphrase
 * @returns {string}
 */
export function readEncryptedBlob(filePath, passphrase) {
  if (!existsSync(filePath)) {
    throw new Error(`encrypted blob not found: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  return decryptBlob(passphrase, raw);
}

/**
 * @param {string} filePath
 * @param {string} passphrase
 * @param {string} plaintext
 */
export function writeEncryptedBlob(filePath, passphrase, plaintext) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const envelope = encryptBlob(passphrase, plaintext);
  writeFileSync(filePath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
}
