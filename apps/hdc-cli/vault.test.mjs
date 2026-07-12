import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyVaultToEnv, defaultVaultPath, readVault, writeVault } from "./vault.mjs";

describe("vault", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
    vi.restoreAllMocks();
  });

  it("readVault returns empty object when file missing", () => {
    expect(readVault(join(tmpdir(), "nope-vault"), "pw")).toEqual({});
  });

  it("roundtrips secrets", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-vault-"));
    const p = join(root, "vault.enc");
    writeVault(p, "pw1", { A: "1", B: "two" });
    expect(readVault(p, "pw1")).toEqual({ A: "1", B: "two" });
    expect(() => readVault(p, "wrong")).toThrow();
  });

  it("readVault rejects unknown format version", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-vault-"));
    const p = join(root, "bad.enc");
    writeFileSync(
      p,
      JSON.stringify({
        v: 99,
        salt: "AA==",
        iv: "AAAAAAAAAAAA",
        tag: "AAAAAAAAAAAAAAAAAAAAAA==",
        data: "AA==",
      }),
      "utf8",
    );
    expect(() => readVault(p, "pw")).toThrow(/unsupported vault format/);
  });

  it("readVault throws on invalid envelope JSON", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-vault-"));
    const p = join(root, "bad-json.enc");
    writeFileSync(p, "not-json", "utf8");
    expect(() => readVault(p, "pw")).toThrow();
  });

  it("applyVaultToEnv no-ops without passphrase or missing vault", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-vault-"));
    const p = join(root, "vault.enc");
    writeVault(p, "pw", { ONLY: "x" });
    applyVaultToEnv(p, undefined);
    applyVaultToEnv(join(root, "missing.enc"), "pw");
  });

  it("applyVaultToEnv merges without overriding existing env", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-vault-"));
    const p = join(root, "vault.enc");
    writeVault(p, "pw", { HDC_VAULT_TEST_MERGE: "from-vault" });
    process.env.HDC_VAULT_TEST_MERGE = "preset";
    applyVaultToEnv(p, "pw");
    expect(process.env.HDC_VAULT_TEST_MERGE).toBe("preset");
    delete process.env.HDC_VAULT_TEST_MERGE;
    applyVaultToEnv(p, "pw");
    expect(process.env.HDC_VAULT_TEST_MERGE).toBe("from-vault");
    delete process.env.HDC_VAULT_TEST_MERGE;
  });

  it("applyVaultToEnv warns on decrypt failure", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-vault-"));
    const p = join(root, "vault.enc");
    writeVault(p, "good", { X: "y" });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyVaultToEnv(p, "bad-pass");
    expect(spy).toHaveBeenCalled();
  });

  it("defaultVaultPath is under home", () => {
    expect(defaultVaultPath()).toMatch(/[\\/]\.hdc[\\/]vault\.enc$/);
  });
});
