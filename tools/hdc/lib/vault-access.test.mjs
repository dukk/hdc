import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readVault, writeVault } from "../vault.mjs";
import { CliExit } from "./cli-exit.mjs";
import { clearVaultPassphraseProcessCache, createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";

describe("createVaultAccess", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
    clearVaultPassphraseProcessCache();
    vi.restoreAllMocks();
  });

  function makeDeps(/** @type {Record<string, unknown>} */ o) {
    const capture = { log: [], warn: [], err: [] };
    const env = { ...(o.envVars ?? {}) };
    const vaultPath = () => join(root, "vault.enc");
    return {
      env,
      log: (...a) => capture.log.push(a.join(" ")),
      error: (...a) => capture.err.push(a.join(" ")),
      warn: (...a) => capture.warn.push(a.join(" ")),
      defaultVaultPath: vaultPath,
      existsSync: o.existsSync ?? existsSync,
      readLineQuestion: o.readLineQuestion ?? (async () => ""),
      _capture: capture,
    };
  }

  it("creates vault with env passphrase when file missing", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    const deps = makeDeps({ envVars: { HDC_VAULT_PASSPHRASE: "from-env" } });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    await a.unlock({});
    expect(readVault(deps.defaultVaultPath(), "from-env")).toEqual({});
  });

  it("decrypts with env when vault exists", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    const vp = join(root, "vault.enc");
    writeVault(vp, "sekrit", { K: "v" });
    const deps = makeDeps({ envVars: { HDC_VAULT_PASSPHRASE: "sekrit" } });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const data = await a.readSecrets({ createIfMissing: false });
    expect(data).toEqual({ K: "v" });
  });

  it("prompts for vault passphrase when env wrong", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    const vp = join(root, "vault.enc");
    writeVault(vp, "good", { A: "1" });
    const q = vi.fn();
    q.mockResolvedValueOnce("good");
    const deps = makeDeps({
      envVars: { HDC_VAULT_PASSPHRASE: "bad" },
      readLineQuestion: q,
    });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const data = await a.readSecrets({ createIfMissing: false });
    expect(data).toEqual({ A: "1" });
    expect(q).toHaveBeenCalled();
    expect(q).toHaveBeenCalledWith("Vault passphrase: ", { mask: true });
  });

  it("getSecret returns stored value without prompting", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", { HDC_X: "stored" });
    const deps = makeDeps({ envVars: { HDC_VAULT_PASSPHRASE: "p" } });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const v = await a.getSecret("HDC_X", { promptLabel: "nope" });
    expect(v).toBe("stored");
  });

  it("getSecret prompts, verifies, and saves", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", {});
    const answers = ["first", "second"];
    const q = vi.fn(async () => /** @type {string} */ (answers.shift() ?? ""));
    const deps = makeDeps({
      envVars: { HDC_VAULT_PASSPHRASE: "p" },
      readLineQuestion: q,
    });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const v = await a.getSecret("HDC_Y", {
      verify: (x) => x === "second",
    });
    expect(v).toBe("second");
    expect(readVault(join(root, "vault.enc"), "p").HDC_Y).toBe("second");
    expect(q.mock.calls.every((/** @type {unknown[]} */ c) => c[1] === undefined || /** @type {{ mask?: boolean }} */ (c[1]).mask === true)).toBe(true);
  });

  it("unlock returns null when vault missing and createIfMissing false", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    const deps = makeDeps({ envVars: {} });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const p = await a.unlock({ createIfMissing: false });
    expect(p).toBe(null);
  });

  it("reuses process passphrase cache across vault access instances", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "shared", { K: "v" });
    const q = vi.fn();
    q.mockResolvedValueOnce("shared");
    const deps = makeDeps({ envVars: {}, readLineQuestion: q });
    const a1 = createVaultAccess(vaultDepsFromCli(deps));
    const a2 = createVaultAccess(vaultDepsFromCli(deps));
    await a1.readSecrets({ createIfMissing: false });
    await a2.readSecrets({ createIfMissing: false });
    expect(q).toHaveBeenCalledTimes(1);
  });

  it("throws CliExit on empty interactive vault passphrase", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", {});
    const q = vi.fn(async () => "");
    const deps = makeDeps({ envVars: {}, readLineQuestion: q });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    await expect(a.readSecrets({ createIfMissing: false })).rejects.toBeInstanceOf(CliExit);
  });
});
