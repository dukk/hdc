import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./lib/cli-app.mjs";
import { createMemoryCliDeps } from "./test/memory-cli-deps.mjs";
import { clearVaultPassphraseProcessCache } from "./lib/vault-access.mjs";
import { readVault, writeVault } from "./vault.mjs";

function writeTree(root, /** @type {Record<string, string>} */ files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
}

describe("runCli", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
    clearVaultPassphraseProcessCache();
    vi.restoreAllMocks();
  });

  it("prints usage for --help with exit 0", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    const code = await runCli(["--help"], deps);
    expect(code).toBe(0);
    expect(capture.logLines.join("\n")).toContain("Usage:");
    expect(capture.logLines.join("\n")).toContain("help [ <topic>");
  });

  it("help topics: overview, run drill-down, script preview, and errors", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "packages/infrastructure/tgt/manifest.json": JSON.stringify({
        id: "tgt",
        title: "Target T",
        env_required: ["HDC_X"],
        inventory_docs: ["inventory/manual/systems/x.md"],
        verbs: { query: { script: "run.mjs" } },
      }),
      "packages/infrastructure/tgt/query/run.mjs": "// line1\n// line2\nprocess.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    expect(await runCli(["help"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("Topic tree");

    expect(await runCli(["help", "run"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toMatch(/run — execute/);

    capture.logLines.length = 0;
    expect(await runCli(["help", "run", "infrastructure"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("tgt");

    capture.logLines.length = 0;
    expect(await runCli(["help", "run", "infrastructure", "tgt"], deps)).toBe(0);
    const tDetail = capture.logLines.join("\n");
    expect(tDetail).toContain("Target T");
    expect(tDetail).toContain("HDC_X");
    expect(tDetail).toContain("deploy\t(not configured)");

    capture.logLines.length = 0;
    expect(await runCli(["help", "run", "infrastructure", "tgt", "query"], deps)).toBe(0);
    const vDetail = capture.logLines.join("\n");
    expect(vDetail).toContain("packages/infrastructure/tgt/query");
    expect(vDetail).toContain("// line1");

    expect(await runCli(["help", "run", "infrastructure", "missing", "query"], deps)).toBe(1);
    expect(await runCli(["help", "run", "infrastructure", "tgt", "deploy"], deps)).toBe(1);
    expect(await runCli(["help", "run", "infrastructure", "tgt", "query", "extra"], deps)).toBe(1);
    expect(await runCli(["help", "run", "nope"], deps)).toBe(1);
    expect(await runCli(["help", "nope"], deps)).toBe(1);
    expect(await runCli(["help", "list", "extra"], deps)).toBe(1);
  });

  it("help and usage examples use cliInvocationForHelp", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    mkdirSync(join(root, "packages"), { recursive: true });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      cliInvocationForHelp: () => "hdc",
    });
    expect(await runCli(["--help"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("hdc list");
    expect(await runCli(["help", "secrets", "set"], deps)).toBe(0);
    const h = capture.logLines.join("\n");
    expect(h).toContain("hdc secrets set");
    expect(h).toMatch(/printf.*\|\s*hdc secrets set/);
  });

  it("env command lists HDC_ variables with secrets redacted", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    mkdirSync(join(root, "packages"), { recursive: true });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      envVars: {
        HDC_PROXMOX_TLS_INSECURE: "1",
        HDC_LEAK_TEST_TOKEN: "supersecret",
        HDC_PLAIN: "visible",
      },
    });
    expect(await runCli(["env"], deps)).toBe(0);
    const out = capture.logLines.join("\n");
    expect(out).toContain(".env");
    expect(out).toContain("HDC_PROXMOX_TLS_INSECURE=1");
    expect(out).toContain("HDC_PLAIN=visible");
    expect(out).toMatch(/HDC_LEAK_TEST_TOKEN=\(set, \d+ chars\)/);
    expect(out).not.toContain("supersecret");
  });

  it("help covers list, secrets, users, and meta branches", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    mkdirSync(join(root, "packages"), { recursive: true });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });

    expect(await runCli(["help", "help"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("hierarchical usage");

    expect(await runCli(["help", "help", "x"], deps)).toBe(1);

    expect(await runCli(["help", "list"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toMatch(/config\.json|packages\//);
    expect(await runCli(["help", "list", "x"], deps)).toBe(1);

    expect(await runCli(["help", "secrets"], deps)).toBe(0);
    expect(await runCli(["help", "secrets", "path"], deps)).toBe(0);
    expect(await runCli(["help", "secrets", "init"], deps)).toBe(0);
    expect(await runCli(["help", "secrets", "list"], deps)).toBe(0);
    expect(await runCli(["help", "secrets", "delete"], deps)).toBe(0);
    expect(await runCli(["help", "secrets", "set"], deps)).toBe(0);
    expect(await runCli(["help", "secrets", "nope"], deps)).toBe(1);
    expect(await runCli(["help", "secrets", "set", "extra"], deps)).toBe(1);

    expect(await runCli(["help", "users"], deps)).toBe(0);
    expect(await runCli(["help", "users", "bootstrap-hdc"], deps)).toBe(0);
    expect(await runCli(["help", "users", "nope"], deps)).toBe(1);
    expect(await runCli(["help", "users", "bootstrap-hdc", "x"], deps)).toBe(1);

    expect(await runCli(["help", "env"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("HDC_");
    expect(await runCli(["help", "env", "x"], deps)).toBe(1);
  });

  it("help run warns when script file missing", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "packages/infrastructure/tgt/manifest.json": JSON.stringify({
        id: "tgt",
        verbs: { query: { script: "run.mjs" } },
      }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    expect(await runCli(["help", "run", "infrastructure", "tgt", "query"], deps)).toBe(0);
    expect(capture.warnLines.join("\n")).toMatch(/script not found/);
  });

  it("errors on unknown command", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    mkdirSync(join(root, "packages"), { recursive: true });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    const code = await runCli(["nope"], deps);
    expect(code).toBe(1);
    expect(capture.errorLines.join("\n")).toMatch(/unknown command/);
  });

  it("lists packages and optional per-package config.json paths", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "packages/infrastructure/t1/manifest.json": JSON.stringify({
        id: "t1",
        title: "One",
        verbs: { query: { script: "run.mjs" } },
      }),
      "packages/infrastructure/t1/config.json": JSON.stringify({ schema_version: 1 }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    const code = await runCli(["list"], deps);
    expect(code).toBe(0);
    const text = capture.logLines.join("\n");
    expect(text).toContain("t1");
    expect(text).toContain("packages/infrastructure/t1/config.json");
    expect(text).toContain("exists");
  });

  it("run validates package, verb, script, forwards spawn status, relays query stdout", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "packages/infrastructure/tgt/manifest.json": JSON.stringify({
        id: "tgt",
        env_required: ["HDC_MISSING_FOR_TEST"],
        verbs: { query: { script: "run.mjs" } },
      }),
      "packages/infrastructure/tgt/query/run.mjs": "process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [], stdoutChunks: [] };
    const spawnMock = vi.fn().mockReturnValue({ status: 0, stdout: '{"from":"query"}\n' });
    const deps = createMemoryCliDeps({
      root,
      capture,
      spawnSync: spawnMock,
    });
    expect(await runCli(["run", "infrastructure", "tgt", "query"], deps)).toBe(0);
    expect(capture.warnLines.join("\n")).toContain("HDC_MISSING_FOR_TEST");
    expect((capture.stdoutChunks ?? []).join("")).toContain('"from":"query"');
    expect(existsSync(join(root, "inventory/manual/targets/tgt.json"))).toBe(false);

    expect(await runCli(["run"], deps)).toBe(1);
    expect(await runCli(["run", "tgt", "query"], deps)).toBe(1);
    expect(await runCli(["run", "infrastructure", "tgt", "nope"], deps)).toBe(1);
    expect(await runCli(["run", "infrastructure", "missing", "query"], deps)).toBe(1);
    expect(await runCli(["run", "service", "tgt", "query"], deps)).toBe(1);
    expect(await runCli(["run", "nope", "tgt", "query"], deps)).toBe(1);

    writeFileSync(
      join(root, "packages/infrastructure/tgt/manifest.json"),
      JSON.stringify({ id: "tgt", verbs: { query: { script: "run.mjs" } } }),
      "utf8",
    );
    rmSync(join(root, "packages/infrastructure/tgt/query/run.mjs"));
    expect(await runCli(["run", "infrastructure", "tgt", "query"], deps)).toBe(1);

    spawnMock.mockReturnValue({ status: null, stdout: "" });
    writeTree(root, {
      "packages/infrastructure/tgt/query/run.mjs": "process.exit(0)\n",
    });
    expect(await runCli(["run", "infrastructure", "tgt", "query"], deps)).toBe(1);
  });

  it("run query prints non-JSON stdout and does not touch inventory paths", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "packages/infrastructure/tgt/manifest.json": JSON.stringify({ id: "tgt", verbs: { query: { script: "run.mjs" } } }),
      "packages/infrastructure/tgt/query/run.mjs": "process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [], stdoutChunks: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: "not-json\n" }),
    });
    expect(await runCli(["run", "infrastructure", "tgt", "query"], deps)).toBe(0);
    expect((capture.stdoutChunks ?? []).join("")).toContain("not-json");
    expect(existsSync(join(root, "inventory/manual/targets/tgt.json"))).toBe(false);
  });

  it("run deploy relays stdout without writing inventory paths", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "packages/infrastructure/tgt/manifest.json": JSON.stringify({
        id: "tgt",
        verbs: { deploy: { script: "run.mjs" } },
      }),
      "packages/infrastructure/tgt/deploy/run.mjs": "process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [], stdoutChunks: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: '{"ok":true}\n' }),
    });
    expect(await runCli(["run", "infrastructure", "tgt", "deploy"], deps)).toBe(0);
    expect((capture.stdoutChunks ?? []).join("")).toContain('"ok":true');
    expect(existsSync(join(root, "inventory/manual/targets/tgt.json"))).toBe(false);
  });

  it("secrets path and missing subcommand", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const vaultPath = join(root, "vault.enc");
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: {},
    });
    expect(await runCli(["secrets", "path"], deps)).toBe(0);
    expect(capture.logLines.at(-1)).toBe(vaultPath);
    expect(await runCli(["secrets"], deps)).toBe(1);
  });

  it("secrets init and duplicate guard", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const vaultPath = join(root, "vault.enc");
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: { HDC_VAULT_PASSPHRASE: "p1" },
    });
    expect(await runCli(["secrets", "init"], deps)).toBe(0);
    expect(await runCli(["secrets", "init"], deps)).toBe(1);
  });

  it("secrets change-passphrase re-encrypts and preserves keys", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "old", { HDC_X: "secret" });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: { HDC_VAULT_PASSPHRASE: "old" },
      readLineQuestion: vi
        .fn()
        .mockResolvedValueOnce("new")
        .mockResolvedValueOnce("new"),
    });
    expect(await runCli(["secrets", "change-passphrase"], deps)).toBe(0);
    expect(readVault(vaultPath, "new")).toEqual({ HDC_X: "secret" });
    expect(() => readVault(vaultPath, "old")).toThrow();
    expect(capture.warnLines.join("\n")).toContain("HDC_VAULT_PASSPHRASE");
  });

  it("secrets change-passphrase errors without vault", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => join(root, "vault.enc"),
      envVars: {},
    });
    expect(await runCli(["secrets", "change-passphrase"], deps)).toBe(1);
    expect(capture.errorLines.join("\n")).toMatch(/no vault/);
  });

  it("secrets change-passphrase rejects confirm mismatch", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "pw", { A: "1" });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: { HDC_VAULT_PASSPHRASE: "pw" },
      readLineQuestion: vi
        .fn()
        .mockResolvedValueOnce("new1")
        .mockResolvedValueOnce("new2"),
    });
    expect(await runCli(["secrets", "change-passphrase"], deps)).toBe(1);
    expect(capture.errorLines.join("\n")).toMatch(/do not match/);
    expect(readVault(vaultPath, "pw")).toEqual({ A: "1" });
  });

  it("help secrets change-passphrase", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    expect(await runCli(["help", "secrets", "change-passphrase"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("change-passphrase");
  });

  it("secrets init interactively when HDC_VAULT_PASSPHRASE is unset", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const vaultPath = join(root, "vault.enc");
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: {},
      readLineQuestion: vi
        .fn()
        .mockResolvedValueOnce("new-pass")
        .mockResolvedValueOnce("new-pass"),
    });
    expect(await runCli(["secrets", "init"], deps)).toBe(0);
    expect(readVault(vaultPath, "new-pass")).toEqual({});
  });

  it("secrets list errors without passphrase or vault", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => join(root, "vault.enc"),
      envVars: {},
    });
    expect(await runCli(["secrets", "list"], deps)).toBe(1);

    const deps2 = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => join(root, "vault.enc"),
      envVars: { HDC_VAULT_PASSPHRASE: "pw" },
    });
    expect(await runCli(["secrets", "list"], deps2)).toBe(1);
  });

  it("secrets list fails when vault cannot be decrypted", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "right", { A: "1" });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: { HDC_VAULT_PASSPHRASE: "wrong" },
    });
    expect(await runCli(["secrets", "list"], deps)).toBe(1);
  });

  it("secrets list and delete flows", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "pw", { HDC_A: "1", HDC_B: "2" });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: { HDC_VAULT_PASSPHRASE: "pw" },
    });
    expect(await runCli(["secrets", "list"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("HDC_A");

    expect(await runCli(["secrets", "delete", "HDC_A"], deps)).toBe(0);
    expect(readVault(vaultPath, "pw")).toEqual({ HDC_B: "2" });
    expect(await runCli(["secrets", "delete", "HDC_A"], deps)).toBe(1);
    expect(await runCli(["secrets", "delete", "bad-name"], deps)).toBe(1);
  });

  it("secrets set validates input sources", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const vaultPath = join(root, "vault.enc");
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: { HDC_VAULT_PASSPHRASE: "pw" },
      readStdinUtf8: () => "stdin-val\n",
      readLineQuestion: async () => "from-prompt",
    });
    expect(await runCli(["secrets", "set", "bad key"], deps)).toBe(1);
    expect(await runCli(["secrets", "set", "HDC_X", "--stdin", "--value", "a"], deps)).toBe(1);
    expect(await runCli(["secrets", "set", "HDC_X", "--value", ""], deps)).toBe(1);

    expect(await runCli(["secrets", "set", "HDC_X", "--value", "v1"], deps)).toBe(0);
    expect(await runCli(["secrets", "set", "HDC_Y", "--stdin"], deps)).toBe(0);
    expect(await runCli(["secrets", "set", "HDC_Z"], deps)).toBe(0);
    expect(readVault(vaultPath, "pw").HDC_Z).toBe("from-prompt");

    writeVault(vaultPath, "pw", { ONLY: "x" });
    const depsBad = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: { HDC_VAULT_PASSPHRASE: "wrong" },
    });
    expect(await runCli(["secrets", "set", "HDC_N", "--value", "1"], depsBad)).toBe(1);
  });

  it("secrets unknown subcommand", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      envVars: { HDC_VAULT_PASSPHRASE: "pw" },
    });
    expect(await runCli(["secrets", "nope"], deps)).toBe(1);
  });

  it("users bootstrap-hdc dry-run, live ssh, and subcommand errors", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "pw", {});
    writeTree(root, {
      "packages/infrastructure/a/manifest.json": JSON.stringify({ id: "a", verbs: {} }),
      "packages/infrastructure/ubuntu/config.json": JSON.stringify({
        schema_version: 1,
        bootstrap_hosts: [
          {
            schema_version: 1,
            id: "p",
            kind: "system",
            tags: ["proxmox"],
            auth: { ssh_user_env: "HDC_PROXMOX_SSH_USER" },
            access: {
              nodes: [{ ssh: "ssh://root@192.0.2.1" }],
            },
          },
        ],
      }),
      "inventory/manual/systems/p.json": JSON.stringify({
        schema_version: 1,
        id: "p",
        kind: "system",
        tags: ["proxmox"],
        auth: { ssh_user_env: "HDC_PROXMOX_SSH_USER" },
        access: {
          nodes: [{ ssh: "ssh://root@192.0.2.1" }],
        },
      }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const spawnMock = vi.fn().mockReturnValue({ status: 0 });
    const depsDry = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: {},
      spawnSync: spawnMock,
    });
    expect(await runCli(["users", "bootstrap-hdc", "--dry-run"], depsDry)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("dry-run");
    expect(spawnMock).not.toHaveBeenCalled();

    const depsLive = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: { HDC_VAULT_PASSPHRASE: "pw", HDC_PROXMOX_SSH_USER: "root" },
      spawnSync: spawnMock,
    });
    expect(
      await runCli(
        [
          "users",
          "bootstrap-hdc",
          "--sidecar",
          "inventory/manual/systems/p.json",
        ],
        depsLive,
      ),
    ).toBe(0);
    expect(spawnMock).toHaveBeenCalled();
    expect(readVault(vaultPath, "pw").HDC_USER_HDC_PASSWORD_P).toMatch(/[A-Za-z0-9_-]{8}/);

    const spawnFail = vi.fn().mockReturnValue({ status: 1 });
    const depsFail = createMemoryCliDeps({
      root,
      capture,
      defaultVaultPath: () => vaultPath,
      envVars: { HDC_VAULT_PASSPHRASE: "pw", HDC_PROXMOX_SSH_USER: "root" },
      spawnSync: spawnFail,
    });
    expect(
      await runCli(
        [
          "users",
          "bootstrap-hdc",
          "--sidecar",
          "inventory/manual/systems/p.json",
        ],
        depsFail,
      ),
    ).toBe(1);

    const emptyRoot = mkdtempSync(join(tmpdir(), "hdc-cli-empty-"));
    mkdirSync(join(emptyRoot, "packages/infrastructure/ubuntu"), { recursive: true });
    const vEmpty = join(emptyRoot, "vault.enc");
    writeVault(vEmpty, "x", {});
    const depsEmpty = createMemoryCliDeps({
      root: emptyRoot,
      capture,
      defaultVaultPath: () => vEmpty,
      envVars: { HDC_VAULT_PASSPHRASE: "x" },
    });
    expect(await runCli(["users", "bootstrap-hdc", "--dry-run"], depsEmpty)).toBe(0);
    expect(capture.warnLines.join("\n")).toMatch(/no bootstrap_hosts/);
    rmSync(emptyRoot, { recursive: true, force: true });

    const depsUsers = createMemoryCliDeps({ root, capture, envVars: {} });
    expect(await runCli(["users"], depsUsers)).toBe(1);
    expect(await runCli(["users", "nope"], depsUsers)).toBe(1);
  });

  it("executes real cli entry for smoke coverage", async () => {
    const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });
});
