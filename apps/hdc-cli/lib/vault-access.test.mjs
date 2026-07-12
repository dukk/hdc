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

  it("readSecrets bulk-reads vaultwarden collection in one list items call", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", { HDC_VAULTWARDEN_MASTER_PASSWORD: "master-pass" });
    const ORG_ID = "org-1111-aaaa-bbbb-cccc";
    const COLL_ID = "coll-2222-dddd-eeee-ffff";
    const spawnSync = vi.fn((exe, args) => {
      const key = args.join(" ");
      if (key === "--version" || key === "bw --version") {
        return { status: 0, stdout: "2024.1.0", stderr: "" };
      }
      if (key === "config server https://vault.example.test") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (key === "login --check") return { status: 0, stdout: "", stderr: "" };
      if (key === "unlock --passwordenv BW_PASSWORD --raw") {
        return { status: 0, stdout: "session-key", stderr: "" };
      }
      if (key === "list organizations") {
        return { status: 0, stdout: JSON.stringify([{ id: ORG_ID, name: "HDC" }]), stderr: "" };
      }
      if (key === `list org-collections --organizationid ${ORG_ID}`) {
        return { status: 0, stdout: JSON.stringify([{ id: COLL_ID, name: "HDC" }]), stderr: "" };
      }
      if (key === `list items --collectionid ${COLL_ID}`) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: "i1",
              name: "HDC_ONE",
              organizationId: ORG_ID,
              login: { username: "HDC_ONE", password: "one", uris: [] },
            },
            {
              id: "i2",
              name: "HDC_TWO",
              organizationId: ORG_ID,
              login: { username: "HDC_TWO", password: "two", uris: [] },
            },
          ]),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: `unexpected: ${key}` };
    });
    const deps = makeDeps({
      envVars: {
        HDC_VAULT_PASSPHRASE: "p",
        HDC_SECRET_BACKEND: "vaultwarden",
        HDC_VAULTWARDEN_URL: "https://vault.example.test",
        HDC_VAULTWARDEN_EMAIL: "ops@example.test",
        HDC_VAULTWARDEN_ORGANIZATION_ID: ORG_ID,
        HDC_VAULTWARDEN_COLLECTION_ID: COLL_ID,
      },
      spawnSync,
    });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    const secrets = await a.readSecrets({ createIfMissing: false });
    expect(secrets).toMatchObject({ HDC_ONE: "one", HDC_TWO: "two" });
    const getPasswordCalls = spawnSync.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1][0] === "get" && c[1][1] === "password",
    );
    expect(getPasswordCalls.length).toBe(0);
  });

  it("getSecret caches vaultwarden values within the same vault access instance", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-va-"));
    writeVault(join(root, "vault.enc"), "p", { HDC_VAULTWARDEN_MASTER_PASSWORD: "master-pass" });
    const ORG_ID = "org-1111-aaaa-bbbb-cccc";
    const COLL_ID = "coll-2222-dddd-eeee-ffff";
    let listItemsCalls = 0;
    const spawnSync = vi.fn((exe, args) => {
      const key = args.join(" ");
      if (key === "--version" || key === "bw --version") {
        return { status: 0, stdout: "2024.1.0", stderr: "" };
      }
      if (key === "config server https://vault.example.test") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (key === "login --check") return { status: 0, stdout: "", stderr: "" };
      if (key === "unlock --passwordenv BW_PASSWORD --raw") {
        return { status: 0, stdout: "session-key", stderr: "" };
      }
      if (key === "list organizations") {
        return { status: 0, stdout: JSON.stringify([{ id: ORG_ID, name: "HDC" }]), stderr: "" };
      }
      if (key === `list org-collections --organizationid ${ORG_ID}`) {
        return { status: 0, stdout: JSON.stringify([{ id: COLL_ID, name: "HDC" }]), stderr: "" };
      }
      if (key === `list items --collectionid ${COLL_ID}`) {
        listItemsCalls += 1;
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: "i1",
              name: "HDC_CACHED",
              organizationId: ORG_ID,
              login: { username: "HDC_CACHED", password: "cached-val", uris: [] },
            },
          ]),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: `unexpected: ${key}` };
    });
    const deps = makeDeps({
      envVars: {
        HDC_VAULT_PASSPHRASE: "p",
        HDC_SECRET_BACKEND: "vaultwarden",
        HDC_VAULTWARDEN_URL: "https://vault.example.test",
        HDC_VAULTWARDEN_EMAIL: "ops@example.test",
        HDC_VAULTWARDEN_ORGANIZATION_ID: ORG_ID,
        HDC_VAULTWARDEN_COLLECTION_ID: COLL_ID,
      },
      spawnSync,
    });
    const a = createVaultAccess(vaultDepsFromCli(deps));
    expect(await a.getSecret("HDC_CACHED", { optional: true })).toBe("cached-val");
    expect(await a.getSecret("HDC_CACHED", { optional: true })).toBe("cached-val");
    expect(listItemsCalls).toBe(2);
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
