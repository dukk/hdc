import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./lib/cli-app.mjs";
import { createMemoryCliDeps } from "./test/memory-cli-deps.mjs";
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
      "automation/tgt/manifest.json": JSON.stringify({
        id: "tgt",
        title: "Target T",
        env_required: ["HDC_X"],
        inventory_docs: ["inventory/manual/systems/x.md"],
        verbs: { query: { script: "run.mjs" } },
      }),
      "automation/tgt/query/run.mjs": "// line1\n// line2\nprocess.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    expect(await runCli(["help"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("Topic tree");

    expect(await runCli(["help", "run"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toMatch(/run — execute/);

    capture.logLines.length = 0;
    expect(await runCli(["help", "run", "tgt"], deps)).toBe(0);
    const tDetail = capture.logLines.join("\n");
    expect(tDetail).toContain("Target T");
    expect(tDetail).toContain("HDC_X");
    expect(tDetail).toContain("deploy\t(not configured)");

    capture.logLines.length = 0;
    expect(await runCli(["help", "run", "tgt", "query"], deps)).toBe(0);
    const vDetail = capture.logLines.join("\n");
    expect(vDetail).toContain("automation/tgt/query");
    expect(vDetail).toContain("// line1");

    expect(await runCli(["help", "run", "missing", "query"], deps)).toBe(1);
    expect(await runCli(["help", "run", "tgt", "deploy"], deps)).toBe(1);
    expect(await runCli(["help", "run", "tgt", "query", "extra"], deps)).toBe(1);
    expect(await runCli(["help", "nope"], deps)).toBe(1);
    expect(await runCli(["help", "docs", "nope"], deps)).toBe(1);
  });

  it("help and usage examples use cliInvocationForHelp", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    mkdirSync(join(root, "automation"), { recursive: true });
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

  it("help covers docs, inventory, secrets, users, and meta branches", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    mkdirSync(join(root, "automation"), { recursive: true });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });

    expect(await runCli(["help", "help"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("hierarchical usage");

    expect(await runCli(["help", "help", "x"], deps)).toBe(1);

    expect(await runCli(["help", "list"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toMatch(/query_last|inventory\/automated/);
    expect(capture.logLines.join("\n")).toMatch(/agent notes|not read or write/i);
    expect(await runCli(["help", "list", "x"], deps)).toBe(1);

    expect(await runCli(["help", "docs"], deps)).toBe(0);
    expect(await runCli(["help", "docs", "lint"], deps)).toBe(0);
    expect(await runCli(["help", "docs", "sync"], deps)).toBe(0);
    expect(await runCli(["help", "docs", "lint", "extra"], deps)).toBe(1);

    expect(await runCli(["help", "inventory"], deps)).toBe(0);
    expect(await runCli(["help", "inventory", "apply"], deps)).toBe(0);
    expect(await runCli(["help", "inventory", "apply", "x"], deps)).toBe(1);
    expect(await runCli(["help", "inventory", "nope"], deps)).toBe(1);

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
  });

  it("help run warns when script file missing", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/tgt/manifest.json": JSON.stringify({
        id: "tgt",
        verbs: { query: { script: "run.mjs" } },
      }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    expect(await runCli(["help", "run", "tgt", "query"], deps)).toBe(0);
    expect(capture.warnLines.join("\n")).toMatch(/script not found/);
  });

  it("errors on unknown command without writing local automated inventory", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "inventory/manual/systems/h.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "matched-box",
        kind: "system",
        access: { nodes: [{ hostnames: ["test-host.lab"], ip: "10.55.1.9" }] },
      }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      hostProbe: () => ({
        hostname: "test-host",
        ips: ["10.55.1.9"],
        platform: "linux",
        arch: "x64",
      }),
    });
    const code = await runCli(["nope"], deps);
    expect(code).toBe(1);
    expect(capture.errorLines.join("\n")).toMatch(/unknown command/);
    expect(existsSync(join(root, "inventory/automated/systems.json"))).toBe(false);
  });

  it("lists automation targets and inventory sidecars", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/t1/manifest.json": JSON.stringify({
        id: "t1",
        title: "One",
        verbs: { query: { script: "run.mjs" } },
      }),
      "inventory/manual/systems/x.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "x",
        kind: "system",
      }),
      "inventory/manual/systems/x.md": "# x\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    const code = await runCli(["list"], deps);
    expect(code).toBe(0);
    const text = capture.logLines.join("\n");
    expect(text).toContain("t1");
    expect(text).toContain("x.inventory.json");
    expect(text).toContain("Automation inventory");
    expect(text).toContain("automation/t1/inventory.json");
    expect(text).toContain("inventory/automated/systems.json");
  });

  it("writes first automated systems row when host matches a manual system and row is missing", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/t1/manifest.json": JSON.stringify({ id: "t1", title: "One", verbs: {} }),
      "inventory/manual/systems/h.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "matched-box",
        kind: "system",
        access: {
          nodes: [{ name: "n", hostnames: ["test-host.lab"], ip: "10.55.1.9" }],
        },
      }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      hostProbe: () => ({
        hostname: "test-host",
        ips: ["10.55.1.9"],
        platform: "linux",
        arch: "x64",
      }),
    });
    expect(await runCli(["list"], deps)).toBe(0);
    const autoPath = join(root, "inventory/automated/systems.json");
    expect(existsSync(autoPath)).toBe(true);
    const doc = JSON.parse(readFileSync(autoPath, "utf8"));
    expect(doc.systems["matched-box"].hdc_local_host.hostname).toBe("test-host");
    expect(capture.logLines.join("\n")).toMatch(/local inventory: wrote first automated snapshot/);
  });

  it("does not run local inventory collection during docs lint", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/a/manifest.json": JSON.stringify({ id: "a", verbs: {} }),
      "inventory/manual/systems/h.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "matched-box",
        kind: "system",
        access: { nodes: [{ hostnames: ["test-host.lab"], ip: "10.55.1.9" }] },
      }),
      "inventory/manual/systems/ok.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "ok",
        kind: "system",
      }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      hostProbe: () => ({
        hostname: "test-host",
        ips: ["10.55.1.9"],
        platform: "linux",
        arch: "x64",
      }),
    });
    expect(await runCli(["docs", "lint"], deps)).toBe(0);
    expect(existsSync(join(root, "inventory/automated/systems.json"))).toBe(false);
    expect(capture.logLines.join("\n")).not.toMatch(/local inventory:/);
  });

  it("run validates target, verb, script, forwards spawn status, and writes automation inventory on query", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/tgt/manifest.json": JSON.stringify({
        id: "tgt",
        env_required: ["HDC_MISSING_FOR_TEST"],
        verbs: { query: { script: "run.mjs" } },
      }),
      "automation/tgt/query/run.mjs": "process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const spawnMock = vi.fn().mockReturnValue({ status: 0, stdout: '{"from":"query"}\n' });
    const deps = createMemoryCliDeps({
      root,
      capture,
      spawnSync: spawnMock,
    });
    expect(await runCli(["run", "tgt", "query"], deps)).toBe(0);
    expect(capture.warnLines.join("\n")).toContain("HDC_MISSING_FOR_TEST");
    expect(capture.logLines.join("\n")).toContain("wrote query snapshot");
    expect(capture.logLines.join("\n")).toContain("updated automated systems inventory");
    const invPath = join(root, "automation/tgt/inventory.json");
    expect(existsSync(invPath)).toBe(true);
    expect(JSON.parse(readFileSync(invPath, "utf8")).query_last).toEqual({ from: "query" });
    const autoPath = join(root, "inventory/automated/systems.json");
    expect(existsSync(autoPath)).toBe(true);
    expect(JSON.parse(readFileSync(autoPath, "utf8")).sources.tgt.last_payload).toEqual({ from: "query" });

    expect(await runCli(["run"], deps)).toBe(1);
    expect(await runCli(["run", "tgt", "nope"], deps)).toBe(1);
    expect(await runCli(["run", "missing", "query"], deps)).toBe(1);

    writeFileSync(
      join(root, "automation/tgt/manifest.json"),
      JSON.stringify({ id: "tgt", verbs: { query: { script: "run.mjs" } } }),
      "utf8",
    );
    rmSync(join(root, "automation/tgt/query/run.mjs"));
    expect(await runCli(["run", "tgt", "query"], deps)).toBe(1);

    spawnMock.mockReturnValue({ status: null, stdout: "" });
    writeTree(root, {
      "automation/tgt/query/run.mjs": "process.exit(0)\n",
    });
    expect(await runCli(["run", "tgt", "query"], deps)).toBe(1);
  });

  it("run query warns when stdout is not JSON but still exits with query status", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/tgt/manifest.json": JSON.stringify({ id: "tgt", verbs: { query: { script: "run.mjs" } } }),
      "automation/tgt/query/run.mjs": "process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: "not-json\n" }),
    });
    expect(await runCli(["run", "tgt", "query"], deps)).toBe(0);
    expect(capture.warnLines.join("\n")).toMatch(/not update inventory\.json/);
    expect(existsSync(join(root, "automation/tgt/inventory.json"))).toBe(false);
  });

  it("run deploy does not write automation inventory.json but updates root automated systems", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/tgt/manifest.json": JSON.stringify({
        id: "tgt",
        verbs: { deploy: { script: "run.mjs" } },
      }),
      "automation/tgt/deploy/run.mjs": "process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: "" }),
    });
    expect(await runCli(["run", "tgt", "deploy"], deps)).toBe(0);
    expect(existsSync(join(root, "automation/tgt/inventory.json"))).toBe(false);
    const autoPath = join(root, "inventory/automated/systems.json");
    expect(existsSync(autoPath)).toBe(true);
    expect(JSON.parse(readFileSync(autoPath, "utf8")).sources.tgt.last_deploy_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("docs lint reports JSON errors and accepts sidecars without companion markdown", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/a/manifest.json": JSON.stringify({ id: "a", verbs: {} }),
      "inventory/manual/systems/bad.inventory.json": "{",
      "inventory/manual/systems/ok.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "ok",
        kind: "system",
      }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    expect(await runCli(["docs", "lint"], deps)).toBe(1);
    expect(capture.errorLines.join("\n")).toContain("invalid JSON");
    expect(capture.errorLines.join("\n")).not.toContain("companion markdown");

    rmSync(join(root, "inventory/manual/systems/bad.inventory.json"));
    expect(await runCli(["docs", "lint"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("ok.inventory.json");
  });

  it("docs lint prints message when no sidecars", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    mkdirSync(join(root, "inventory/manual"), { recursive: true });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    expect(await runCli(["docs", "lint"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toContain("inventory/manual/");
  });

  it("docs sync validates JSON like lint and does not modify companion markdown", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/a/manifest.json": JSON.stringify({ id: "a", verbs: {} }),
      "inventory/manual/systems/s.inventory.json": "{",
      "inventory/manual/systems/g.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "g",
        kind: "system",
      }),
      "inventory/manual/systems/g.md": "# g\nagent notes unchanged\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    expect(await runCli(["docs", "sync", "--dry-run"], deps)).toBe(1);

    rmSync(join(root, "inventory/manual/systems/s.inventory.json"));
    expect(await runCli(["docs", "sync", "--dry-run"], deps)).toBe(0);
    expect(capture.logLines.join("\n")).toMatch(/dry-run:.*companion \.md not used/);
    expect(readFileSync(join(root, "inventory/manual/systems/g.md"), "utf8")).toContain("agent notes unchanged");

    expect(await runCli(["docs", "sync"], deps)).toBe(0);
    expect(readFileSync(join(root, "inventory/manual/systems/g.md"), "utf8")).toContain("agent notes unchanged");
    expect(capture.logLines.join("\n")).toContain("companion .md not used by hdc");
  });

  it("inventory apply validates arguments and paths", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/a/manifest.json": JSON.stringify({ id: "a", verbs: {} }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    expect(await runCli(["inventory", "apply"], deps)).toBe(1);
    expect(await runCli(["inventory", "apply", "--sidecar", "x", "--from-json", "y"], deps)).toBe(1);
  });

  it("inventory apply merges query and validates sidecar", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-"));
    writeTree(root, {
      "automation/a/manifest.json": JSON.stringify({ id: "a", verbs: {} }),
      "side.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "s",
        kind: "system",
      }),
      "q.json": JSON.stringify({ ping: 1 }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });
    const code = await runCli(
      ["inventory", "apply", "--sidecar", "side.inventory.json", "--from-json", "q.json"],
      deps,
    );
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "side.inventory.json"), "utf8")).query_last).toEqual({
      ping: 1,
    });
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
      "automation/a/manifest.json": JSON.stringify({ id: "a", verbs: {} }),
      "inventory/manual/systems/p.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "p",
        kind: "system",
        tags: ["proxmox"],
        auth: { ssh_user_env: "HDC_PROXMOX_SSH_USER" },
        access: {
          nodes: [{ ssh: "ssh://root@10.0.0.1" }],
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
          "inventory/manual/systems/p.inventory.json",
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
          "inventory/manual/systems/p.inventory.json",
        ],
        depsFail,
      ),
    ).toBe(1);

    const emptyRoot = mkdtempSync(join(tmpdir(), "hdc-cli-empty-"));
    mkdirSync(join(emptyRoot, "inventory/manual"), { recursive: true });
    const vEmpty = join(emptyRoot, "vault.enc");
    writeVault(vEmpty, "x", {});
    const depsEmpty = createMemoryCliDeps({
      root: emptyRoot,
      capture,
      defaultVaultPath: () => vEmpty,
      envVars: { HDC_VAULT_PASSPHRASE: "x" },
    });
    expect(await runCli(["users", "bootstrap-hdc", "--dry-run"], depsEmpty)).toBe(0);
    expect(capture.warnLines.join("\n")).toMatch(/no matching inventory sidecars/);
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
