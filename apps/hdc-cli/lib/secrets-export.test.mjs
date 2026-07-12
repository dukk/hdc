import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  filterSecretsForExport,
  formatEnvLine,
  parseSecretsExportArgv,
  writeSecretExport,
} from "./secrets-export.mjs";

describe("secrets-export", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("formatEnvLine quotes special characters", () => {
    expect(formatEnvLine("K", "plain")).toBe("K=plain");
    expect(formatEnvLine("K", "has space")).toBe('K="has space"');
    expect(formatEnvLine("K", 'a"b')).toBe('K="a\\"b"');
  });

  it("filterSecretsForExport excludes bootstrap keys by default", () => {
    const all = {
      HDC_A: "1",
      HDC_VAULTWARDEN_MASTER_PASSWORD: "mp",
    };
    const { secrets } = filterSecretsForExport(all, {});
    expect(secrets).toEqual({ HDC_A: "1" });
    const inc = filterSecretsForExport(all, { includeBootstrap: true });
    expect(inc.secrets.HDC_VAULTWARDEN_MASTER_PASSWORD).toBe("mp");
  });

  it("writeSecretExport writes per-key files and env bundle", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-export-"));
    const capture = { logLines: [] };
    const deps = {
      log: (...a) => capture.logLines.push(a.join(" ")),
      error: () => {},
      join,
      resolve: (p) => resolve(root, p),
      existsSync,
    };

    const dir = join(root, "out");
    const parsed = parseSecretsExportArgv(["dump", "--out-dir", dir]);
    const { written, destination } = writeSecretExport(
      deps,
      { HDC_A: "va", HDC_B: "vb" },
      parsed,
    );
    expect(written).toBe(2);
    expect(destination).toBe(resolve(root, dir));
    expect(readFileSync(join(dir, "HDC_A"), "utf8")).toBe("va");
    expect(readFileSync(join(dir, "HDC_B"), "utf8")).toBe("vb");

    const envParsed = parseSecretsExportArgv([
      "dump",
      "--out-dir",
      join(root, "env-out"),
      "--format",
      "env",
    ]);
    writeSecretExport(deps, { HDC_A: "va" }, envParsed);
    const envContent = readFileSync(join(root, "env-out", "secrets.env"), "utf8");
    expect(envContent).toBe("HDC_A=va\n");
  });

  it("writeSecretExport refuses overwrite without --force", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-export-"));
    const outFile = join(root, "existing");
    writeFileSync(outFile, "old", "utf8");
    const deps = {
      log: () => {},
      error: () => {},
      join,
      resolve: (p) => resolve(root, p),
      existsSync: () => true,
    };
    const parsed = parseSecretsExportArgv(["get", "HDC_X", "--out", "existing"]);
    expect(() =>
      writeSecretExport(deps, { HDC_X: "new" }, parsed),
    ).toThrow(/output exists/);
  });
});
