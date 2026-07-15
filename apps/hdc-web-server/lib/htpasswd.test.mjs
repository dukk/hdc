import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import { decryptBlob, encryptBlob, readEncryptedBlob, writeEncryptedBlob } from "./encrypted-blob.mjs";
import {
  ensureHtpasswdStore,
  hashPassword,
  parseHtpasswd,
  serializeHtpasswd,
  verifyPassword,
  verifyUser,
} from "./htpasswd.mjs";

describe("encrypted-blob", () => {
  it("round-trips plaintext", () => {
    const envelope = encryptBlob("session-secret", "admin:$apr1$abc$xyz\n");
    const plain = decryptBlob("session-secret", envelope);
    expect(plain).toBe("admin:$apr1$abc$xyz\n");
  });

  it("fails decrypt with wrong passphrase", () => {
    const envelope = encryptBlob("session-secret", "secret");
    expect(() => decryptBlob("wrong", envelope)).toThrow();
  });
});

describe("htpasswd apr1", () => {
  it("verifies password against stored hash", () => {
    const hash = hashPassword("test-password", "abcdefgh");
    expect(hash.startsWith("$apr1$abcdefgh$")).toBe(true);
    expect(verifyPassword("test-password", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("parses and serializes htpasswd lines", () => {
    const store = parseHtpasswd("admin:$apr1$aa$bb\n# comment\nuser:{SHA}hash\n");
    expect(store.size).toBe(2);
    expect(store.get("admin")).toBe("$apr1$aa$bb");
    const text = serializeHtpasswd(store);
    expect(text).toContain("admin:$apr1$aa$bb");
    expect(text).toContain("user:{SHA}hash");
  });
});

describe("ensureHtpasswdStore", () => {
  /** @type {string[]} */
  const dirs = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempFile(name = ".htpasswd.enc") {
    const dir = mkdtempSync(join(tmpdir(), "hdc-web-htpasswd-"));
    dirs.push(dir);
    return join(dir, name);
  }

  it("creates admin user when file missing", () => {
    const filePath = tempFile();
    const result = ensureHtpasswdStore({
      filePath,
      encryptKey: "test-secret",
      adminUsername: "admin",
      adminPassword: "preset-pass",
    });
    expect(result.createdAdmin).toBe(true);
    expect(result.generatedPassword).toBeUndefined();
    expect(verifyUser(result.store, "admin", "preset-pass")).toBe(true);

    const plain = readEncryptedBlob(filePath, "test-secret");
    expect(plain).toContain("admin:$apr1$");
  });

  it("generates password when adminPassword omitted", () => {
    const filePath = tempFile();
    const result = ensureHtpasswdStore({
      filePath,
      encryptKey: "test-secret",
      adminUsername: "admin",
    });
    expect(result.createdAdmin).toBe(true);
    expect(result.generatedPassword).toBeTruthy();
    expect(verifyUser(result.store, "admin", result.generatedPassword)).toBe(true);
  });

  it("does not overwrite existing admin", () => {
    const filePath = tempFile();
    ensureHtpasswdStore({
      filePath,
      encryptKey: "test-secret",
      adminUsername: "admin",
      adminPassword: "first-pass",
    });
    const second = ensureHtpasswdStore({
      filePath,
      encryptKey: "test-secret",
      adminUsername: "admin",
      adminPassword: "second-pass",
    });
    expect(second.createdAdmin).toBe(false);
    expect(verifyUser(second.store, "admin", "first-pass")).toBe(true);
    expect(verifyUser(second.store, "admin", "second-pass")).toBe(false);
  });

  it("adds admin when file has other users only", () => {
    const filePath = tempFile();
    const initial = new Map([["ops", hashPassword("ops-pass")]]);
    writeEncryptedBlob(filePath, "test-secret", serializeHtpasswd(initial));

    const result = ensureHtpasswdStore({
      filePath,
      encryptKey: "test-secret",
      adminUsername: "admin",
      adminPassword: "admin-pass",
    });
    expect(result.createdAdmin).toBe(true);
    expect(result.store.size).toBe(2);
    expect(verifyUser(result.store, "ops", "ops-pass")).toBe(true);
    expect(verifyUser(result.store, "admin", "admin-pass")).toBe(true);
  });
});
