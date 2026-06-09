import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readVault, writeVault } from "../vault.mjs";
import { CliExit } from "./cli-exit.mjs";
import { clearVaultPassphraseProcessCache, createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { clearBwSessionProcessCache } from "./vaultwarden-cli.mjs";

describe("createVaultAccess secret backend", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
    clearVaultPassphraseProcessCache();
    clearBwSessionProcessCache();
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
      spawnSync: o.spawnSync,
      _capture: capture,
    };
  }

  it("local-only keys bypass vaultwarden backend", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", { HDC_VAULTWARDEN_ADMIN_TOKEN: "admin" });
    const spawnSync = vi.fn(() => ({ status: 1, stdout: "", stderr: "should not run" }));
    const deps = makeDeps({
      envVars: {
        HDC_VAULT_PASSPHRASE: "p",
        HDC_SECRET_BACKEND: "vaultwarden",
        HDC_VAULTWARDEN_URL: "https://vault.example.test",
        HDC_VAULTWARDEN_EMAIL: "ops@example.test",
      },
      spawnSync,
    });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const v = await a.getSecret("HDC_VAULTWARDEN_ADMIN_TOKEN");
    expect(v).toBe("admin");
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("auto backend falls back to local vault when bw missing", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", { HDC_X: "local-val" });
    const spawnSync = vi.fn(() => ({ status: 1, stdout: "", stderr: "not found" }));
    const deps = makeDeps({
      envVars: {
        HDC_VAULT_PASSPHRASE: "p",
        HDC_SECRET_BACKEND: "auto",
        HDC_VAULTWARDEN_URL: "https://vault.example.test",
        HDC_VAULTWARDEN_EMAIL: "ops@example.test",
      },
      spawnSync,
    });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const v = await a.getSecret("HDC_X");
    expect(v).toBe("local-val");
    expect(deps._capture.warn.some((m) => m.includes("Vaultwarden backend unavailable"))).toBe(true);
  });
});

describe("createVaultAccess local vault", () => {
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

  it("getSecret returns stored value without prompting", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", { HDC_X: "stored" });
    const deps = makeDeps({ envVars: { HDC_VAULT_PASSPHRASE: "p" } });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const v = await a.getSecret("HDC_X", { promptLabel: "nope" });
    expect(v).toBe("stored");
  });

  it("getSecret optional returns empty without prompting when missing", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", {});
    const q = vi.fn(async () => "should-not-prompt");
    const deps = makeDeps({ envVars: { HDC_VAULT_PASSPHRASE: "p" }, readLineQuestion: q });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const v = await a.getSecret("HDC_CROWDSEC_ENROLL_KEY", { optional: true });
    expect(v).toBe("");
    expect(q).not.toHaveBeenCalled();
  });

  it("getSecret optional prefers env over vault", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", { HDC_CROWDSEC_ENROLL_KEY: "vault-key" });
    const deps = makeDeps({
      envVars: { HDC_VAULT_PASSPHRASE: "p", HDC_CROWDSEC_ENROLL_KEY: "env-key" },
    });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const v = await a.getSecret("HDC_CROWDSEC_ENROLL_KEY", { optional: true });
    expect(v).toBe("env-key");
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
