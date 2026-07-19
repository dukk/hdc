import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readVault, writeVault } from "../vault.mjs";
import {
  BOOTSTRAP_BACKUP_PREFIX,
  VAULT_BACKUP_PREFIX,
  backupTimestamp,
  collectBootstrapEnvFiles,
  parseSecretsBackupArgv,
  pruneBackupFiles,
  restoreBootstrapBundle,
  runSecretsBackup,
  splitBackupDirs,
  unlockLocalVaultPassphrase,
} from "./secrets-backup.mjs";

function writeTree(root, /** @type {Record<string, string>} */ files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
}

describe("secrets-backup parsing", () => {
  it("splitBackupDirs splits on semicolons and trims", () => {
    expect(splitBackupDirs("a;b ; ;c")).toEqual(["a", "b", "c"]);
    expect(splitBackupDirs(undefined)).toEqual([]);
    expect(splitBackupDirs("D:/backups;\\\\nas\\share")).toEqual([
      "D:/backups",
      "\\\\nas\\share",
    ]);
  });

  it("parseSecretsBackupArgv reads --dest, --retain, --dry-run", () => {
    const parsed = parseSecretsBackupArgv(
      ["--dest", "a", "--dest", "b", "--retain", "5", "--dry-run"],
      {},
    );
    expect(parsed.dests).toEqual(["a", "b"]);
    expect(parsed.retain).toBe(5);
    expect(parsed.dryRun).toBe(true);
  });

  it("parseSecretsBackupArgv falls back to env for dests and retain", () => {
    const parsed = parseSecretsBackupArgv([], {
      HDC_VAULT_BACKUP_DIRS: "x;y",
      HDC_VAULT_BACKUP_RETAIN: "7",
    });
    expect(parsed.dests).toEqual(["x", "y"]);
    expect(parsed.retain).toBe(7);
    expect(parsed.dryRun).toBe(false);
  });

  it("parseSecretsBackupArgv defaults retain to 30 on bad input", () => {
    expect(parseSecretsBackupArgv(["--retain", "abc"], {}).retain).toBe(30);
    expect(parseSecretsBackupArgv([], {}).retain).toBe(30);
  });

  it("backupTimestamp is filesystem safe and sortable", () => {
    const ts = backupTimestamp(new Date("2026-07-18T03:00:00Z"));
    expect(ts).toBe("2026-07-18T03-00-00");
  });
});

describe("collectBootstrapEnvFiles", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("collects root and clump .env files from hdc and hdc-private", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-backup-"));
    const pub = join(root, "hdc");
    const priv = join(root, "private");
    writeTree(pub, {
      ".env": "HDC_A=1\n",
      "clumps/services/bind/.env": "HDC_B=2\n",
      "clumps/infrastructure/proxmox/.env": "HDC_C=3\n",
      "clumps/services/bind/config.json": "{}",
    });
    writeTree(priv, {
      ".env": "HDC_P=4\n",
      "clumps/services/uptime-kuma/.env": "HDC_UK=5\n",
    });
    const out = collectBootstrapEnvFiles(pub, { HDC_PRIVATE_ROOT: priv });
    expect(Object.keys(out).sort()).toEqual([
      "hdc-private/.env",
      "hdc-private/clumps/services/uptime-kuma/.env",
      "hdc/.env",
      "hdc/clumps/infrastructure/proxmox/.env",
      "hdc/clumps/services/bind/.env",
    ]);
    expect(out["hdc/.env"]).toBe("HDC_A=1\n");
    expect(out["hdc-private/clumps/services/uptime-kuma/.env"]).toBe("HDC_UK=5\n");
  });
});

describe("runSecretsBackup", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  function makeLog() {
    const lines = [];
    return { lines, log: (...a) => lines.push(a.join(" ")), warn: (...a) => lines.push(a.join(" ")) };
  }

  it("copies vault.enc and writes a decryptable bootstrap bundle", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-backup-"));
    const pub = join(root, "hdc");
    const dest = join(root, "dest");
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "pw", { HDC_X: "42" });
    writeTree(pub, { ".env": "HDC_A=1\n" });

    const { log, warn } = makeLog();
    const result = runSecretsBackup({
      vaultPath,
      passphrase: "pw",
      publicRoot: pub,
      env: { HDC_PRIVATE_ROOT: join(root, "nope") },
      dests: [dest],
      retain: 10,
      log,
      warn,
      now: new Date("2026-07-18T03:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.bootstrapLabels).toEqual(["hdc/.env"]);
    const d = result.destinations[0];
    expect(d.ok).toBe(true);
    expect(d.vaultFile && existsSync(d.vaultFile)).toBe(true);
    expect(d.bootstrapFile && existsSync(d.bootstrapFile)).toBe(true);

    // the vault copy is byte-identical (still decryptable)
    expect(readVault(/** @type {string} */ (d.vaultFile), "pw")).toEqual({ HDC_X: "42" });
    // the bootstrap bundle decrypts with the same passphrase
    expect(readVault(/** @type {string} */ (d.bootstrapFile), "pw")).toEqual({
      "hdc/.env": "HDC_A=1\n",
    });
  });

  it("prunes old backups beyond retain per prefix", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-backup-"));
    const pub = join(root, "hdc");
    const dest = join(root, "dest");
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "pw", {});
    writeTree(pub, { ".env": "HDC_A=1\n" });
    mkdirSync(dest, { recursive: true });
    for (const stamp of ["2020-01-01T00-00-00", "2020-01-02T00-00-00"]) {
      writeFileSync(join(dest, `${VAULT_BACKUP_PREFIX}${stamp}.enc`), "old", "utf8");
      writeFileSync(join(dest, `${BOOTSTRAP_BACKUP_PREFIX}${stamp}.enc`), "old", "utf8");
    }

    const { log, warn } = makeLog();
    const result = runSecretsBackup({
      vaultPath,
      passphrase: "pw",
      publicRoot: pub,
      env: { HDC_PRIVATE_ROOT: join(root, "nope") },
      dests: [dest],
      retain: 1,
      log,
      warn,
      now: new Date("2026-07-18T03:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.destinations[0].pruned.length).toBe(4);
    const names = readdirSync(dest).sort();
    expect(names).toEqual([
      `${BOOTSTRAP_BACKUP_PREFIX}2026-07-18T03-00-00.enc`,
      `${VAULT_BACKUP_PREFIX}2026-07-18T03-00-00.enc`,
    ]);
  });

  it("dry-run writes nothing", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-backup-"));
    const pub = join(root, "hdc");
    const dest = join(root, "dest");
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "pw", {});
    writeTree(pub, { ".env": "HDC_A=1\n" });

    const { lines, log, warn } = makeLog();
    const result = runSecretsBackup({
      vaultPath,
      passphrase: "",
      publicRoot: pub,
      env: { HDC_PRIVATE_ROOT: join(root, "nope") },
      dests: [dest],
      retain: 10,
      dryRun: true,
      log,
      warn,
    });
    expect(result.ok).toBe(true);
    expect(existsSync(dest)).toBe(false);
    expect(lines.join("\n")).toMatch(/\[dry-run] would copy/);
  });

  it("throws when no destinations are configured", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-backup-"));
    const { log, warn } = makeLog();
    expect(() =>
      runSecretsBackup({
        vaultPath: join(root, "vault.enc"),
        passphrase: "pw",
        publicRoot: root,
        env: {},
        dests: [],
        retain: 10,
        log,
        warn,
      }),
    ).toThrow(/no destination/);
  });

  it("continues to remaining destinations when one fails", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-backup-"));
    const pub = join(root, "hdc");
    const goodDest = join(root, "dest");
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "pw", {});
    writeTree(pub, { ".env": "HDC_A=1\n" });
    // a file path used as a directory forces mkdir failure
    const badDest = join(root, "not-a-dir");
    writeFileSync(badDest, "file", "utf8");

    const { log, warn } = makeLog();
    const result = runSecretsBackup({
      vaultPath,
      passphrase: "pw",
      publicRoot: pub,
      env: { HDC_PRIVATE_ROOT: join(root, "nope") },
      dests: [badDest, goodDest],
      retain: 10,
      log,
      warn,
    });
    expect(result.ok).toBe(false);
    expect(result.destinations[0].ok).toBe(false);
    expect(result.destinations[1].ok).toBe(true);
  });
});

describe("pruneBackupFiles", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("keeps the newest N by name and ignores other files", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-prune-"));
    for (const stamp of ["2026-01-01T00-00-00", "2026-01-02T00-00-00", "2026-01-03T00-00-00"]) {
      writeFileSync(join(root, `${VAULT_BACKUP_PREFIX}${stamp}.enc`), "x", "utf8");
    }
    writeFileSync(join(root, "unrelated.txt"), "x", "utf8");
    const deleted = pruneBackupFiles(root, VAULT_BACKUP_PREFIX, 2);
    expect(deleted).toEqual([`${VAULT_BACKUP_PREFIX}2026-01-01T00-00-00.enc`]);
    expect(existsSync(join(root, "unrelated.txt"))).toBe(true);
  });

  it("returns empty for a missing directory", () => {
    expect(pruneBackupFiles(join(tmpdir(), "does-not-exist-hdc"), VAULT_BACKUP_PREFIX, 1)).toEqual([]);
  });
});

describe("restoreBootstrapBundle", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("round-trips a backup bundle into .env files", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-restore-"));
    const bundle = join(root, `${BOOTSTRAP_BACKUP_PREFIX}x.enc`);
    writeVault(bundle, "pw", {
      "hdc/.env": "HDC_A=1\n",
      "hdc-private/clumps/services/bind/.env": "HDC_B=2\n",
    });
    const outDir = join(root, "restored");
    const { written } = restoreBootstrapBundle({ file: bundle, passphrase: "pw", outDir });
    expect(written.length).toBe(2);
    expect(readFileSync(join(outDir, "hdc", ".env"), "utf8")).toBe("HDC_A=1\n");
    expect(
      readFileSync(join(outDir, "hdc-private", "clumps", "services", "bind", ".env"), "utf8"),
    ).toBe("HDC_B=2\n");
  });

  it("refuses overwrite without force", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-restore-"));
    const bundle = join(root, "bundle.enc");
    writeVault(bundle, "pw", { "hdc/.env": "new\n" });
    const outDir = join(root, "restored");
    writeTree(outDir, { "hdc/.env": "old\n" });
    expect(() =>
      restoreBootstrapBundle({ file: bundle, passphrase: "pw", outDir }),
    ).toThrow(/output exists/);
    const { written } = restoreBootstrapBundle({
      file: bundle,
      passphrase: "pw",
      outDir,
      force: true,
    });
    expect(written.length).toBe(1);
    expect(readFileSync(join(outDir, "hdc", ".env"), "utf8")).toBe("new\n");
  });

  it("rejects unsafe paths in the bundle", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-restore-"));
    const bundle = join(root, "bundle.enc");
    writeVault(bundle, "pw", { "../escape.env": "x" });
    expect(() =>
      restoreBootstrapBundle({ file: bundle, passphrase: "pw", outDir: join(root, "out") }),
    ).toThrow(/unsafe path/);
  });
});

describe("unlockLocalVaultPassphrase", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  function makeDeps(vaultPath, envVars = {}, answer = "") {
    return {
      env: { HDC_SECRET_BACKEND: "local", ...envVars },
      log: () => {},
      warn: () => {},
      error: () => {},
      defaultVaultPath: () => vaultPath,
      existsSync,
      readLineQuestion: async () => answer,
    };
  }

  it("uses HDC_VAULT_PASSPHRASE against an existing vault", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-unlock-"));
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "pw", {});
    const pass = await unlockLocalVaultPassphrase(
      makeDeps(vaultPath, { HDC_VAULT_PASSPHRASE: "pw" }),
    );
    expect(pass).toBe("pw");
  });

  it("falls back to env passphrase when the vault file is missing", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-unlock-"));
    const pass = await unlockLocalVaultPassphrase(
      makeDeps(join(root, "missing.enc"), { HDC_VAULT_PASSPHRASE: "pw2" }),
    );
    expect(pass).toBe("pw2");
  });

  it("prompts when nothing else is available and rejects empty input", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-unlock-"));
    const deps = makeDeps(join(root, "missing.enc"), {}, "typed-pass");
    expect(await unlockLocalVaultPassphrase(deps)).toBe("typed-pass");
    const emptyDeps = makeDeps(join(root, "missing.enc"), {}, "");
    await expect(unlockLocalVaultPassphrase(emptyDeps)).rejects.toThrow(/empty vault passphrase/);
  });
});
