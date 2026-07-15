import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";

import { readEncryptedBlob, writeEncryptedBlob } from "./encrypted-blob.mjs";

const APR1_MAGIC = "$apr1$";
const APR1_SALT_CHARS = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * @param {number} count
 * @returns {string}
 */
function randomApr1Salt(count = 8) {
  const bytes = randomBytes(count);
  let out = "";
  for (let i = 0; i < count; i++) {
    out += APR1_SALT_CHARS[bytes[i] % APR1_SALT_CHARS.length];
  }
  return out;
}

/**
 * Apache APR1-MD5 base64 variant (htpasswd -m).
 * @param {Buffer} input
 * @returns {string}
 */
function apr1Base64(input) {
  const tab = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let output = "";
  let i = 0;
  while (i + 2 < input.length) {
    const v = (input[i] << 16) | (input[i + 1] << 8) | input[i + 2];
    output += tab[(v >> 18) & 63];
    output += tab[(v >> 12) & 63];
    output += tab[(v >> 6) & 63];
    output += tab[v & 63];
    i += 3;
  }
  const remaining = input.length - i;
  if (remaining === 1) {
    const v = input[i] << 16;
    output += tab[(v >> 18) & 63];
    output += tab[(v >> 12) & 63];
  } else if (remaining === 2) {
    const v = (input[i] << 16) | (input[i + 1] << 8);
    output += tab[(v >> 18) & 63];
    output += tab[(v >> 12) & 63];
    output += tab[(v >> 6) & 63];
  }
  return output;
}

/**
 * @param {string} password
 * @param {string} salt
 * @returns {string}
 */
export function hashPasswordApr1(password, salt = randomApr1Salt()) {
  const salt8 = String(salt).slice(0, 8);
  const pw = Buffer.from(password, "utf8");
  const saltBuf = Buffer.from(salt8, "utf8");

  let ctx = createHash("md5");
  ctx.update(pw);
  ctx.update(APR1_MAGIC);
  ctx.update(saltBuf);
  let hash = ctx.digest();

  ctx = createHash("md5");
  ctx.update(pw);
  ctx.update(saltBuf);
  ctx.update(pw);
  const alt = ctx.digest();

  for (let i = pw.length; i > 0; i -= 16) {
    hash = createHash("md5")
      .update(Buffer.concat([hash, alt.subarray(0, Math.min(16, i))]))
      .digest();
  }

  /** @type {Buffer} */
  let work = Buffer.alloc(0);
  for (let i = pw.length; i > 0; i >>= 1) {
    work = Buffer.concat([work, i & 1 ? Buffer.from([0]) : pw.subarray(0, 1)]);
  }

  hash = createHash("md5").update(Buffer.concat([hash, work])).digest();

  for (let i = 0; i < 1000; i++) {
    const parts = [];
    if (i & 1) parts.push(pw);
    else parts.push(hash);
    if (i % 3) parts.push(saltBuf);
    if (i % 7) parts.push(pw);
    hash = createHash("md5").update(Buffer.concat(parts)).digest();
  }

  return `${APR1_MAGIC}${salt8}$${apr1Base64(hash)}`;
}

/** @param {string} password @param {string} [salt] */
export function hashPassword(password, salt) {
  return hashPasswordApr1(password, salt);
}

/**
 * @param {string} password
 * @param {string} stored
 * @returns {boolean}
 */
export function verifyPassword(password, stored) {
  if (!password || !stored) return false;
  if (!stored.startsWith(APR1_MAGIC)) return false;
  const parts = stored.split("$");
  if (parts.length < 4) return false;
  const salt = parts[2];
  const expected = hashPasswordApr1(password, salt);
  const a = Buffer.from(expected);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseHtpasswd(text) {
  /** @type {Map<string, string>} */
  const store = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const username = trimmed.slice(0, idx).trim();
    const hash = trimmed.slice(idx + 1).trim();
    if (username && hash) store.set(username, hash);
  }
  return store;
}

/**
 * @param {Map<string, string>} store
 * @returns {string}
 */
export function serializeHtpasswd(store) {
  return [...store.entries()].map(([user, hash]) => `${user}:${hash}`).join("\n") + "\n";
}

/**
 * @param {Map<string, string>} store
 * @param {string} username
 * @param {string} password
 * @returns {boolean}
 */
export function verifyUser(store, username, password) {
  if (!username || !password) return false;
  const hash = store.get(username);
  if (!hash) return false;
  return verifyPassword(password, hash);
}

/**
 * @param {{
 *   filePath: string;
 *   encryptKey: string;
 *   adminUsername?: string;
 *   adminPassword?: string;
 * }} opts
 * @returns {{ store: Map<string, string>; createdAdmin: boolean; generatedPassword?: string }}
 */
export function ensureHtpasswdStore(opts) {
  const {
    filePath,
    encryptKey,
    adminUsername = "admin",
    adminPassword = "",
  } = opts;

  if (!encryptKey) {
    throw new Error("encryptKey required for htpasswd store");
  }

  /** @type {Map<string, string>} */
  let store;
  const fileExists = existsSync(filePath);

  if (fileExists) {
    try {
      const plain = readEncryptedBlob(filePath, encryptKey);
      store = parseHtpasswd(plain);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `cannot decrypt htpasswd file ${filePath} (wrong HDC_WEB_UI_SESSION_SECRET?): ${msg}`,
      );
    }
  } else {
    store = new Map();
  }

  if (store.has(adminUsername)) {
    return { store, createdAdmin: false };
  }

  let password = String(adminPassword ?? "").trim();
  /** @type {string | undefined} */
  let generatedPassword;
  if (!password) {
    generatedPassword = randomBytes(18).toString("base64url");
    password = generatedPassword;
  }

  store.set(adminUsername, hashPassword(password));
  writeEncryptedBlob(filePath, encryptKey, serializeHtpasswd(store));

  return { store, createdAdmin: true, generatedPassword };
}
