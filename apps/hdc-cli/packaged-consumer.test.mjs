import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveRepoFile, hdcPrivateRoot } from "./lib/private-repo.mjs";
import { augmentPackageSpawnEnv } from "./lib/package/spawn-env.mjs";
import { bootstrapGlobalEnv } from "./lib/clump-env.mjs";
import { join as pathJoin } from "node:path";

/**
 * Mimics npm consumer layout: platform share/ + operator workspace cwd.
 */
describe("packaged consumer", () => {
  /** @type {string} */
  let packageRoot;
  /** @type {string} */
  let shareRoot;
  /** @type {string} */
  let operatorRoot;

  beforeEach(() => {
    packageRoot = mkdtempSync(join(tmpdir(), "hdc-pkg-"));
    shareRoot = join(packageRoot, "share");
    operatorRoot = mkdtempSync(join(tmpdir(), "hdc-op-"));
    mkdirSync(join(shareRoot, ".hdc"), { recursive: true });
    mkdirSync(join(shareRoot, "operations", "inventory", "systems"), { recursive: true });
    writeFileSync(
      join(shareRoot, ".hdc", "clumps-repos.json"),
      JSON.stringify({ version: 1, repos: [], precedence: [] }),
      "utf8",
    );
    writeFileSync(
      join(shareRoot, "operations", "inventory", "systems", "_example.json"),
      '{"id":"example"}\n',
      "utf8",
    );
    mkdirSync(join(operatorRoot, "clumps", "services", "pi-hole"), { recursive: true });
    mkdirSync(join(operatorRoot, "operations", "inventory", "systems"), { recursive: true });
    writeFileSync(
      join(operatorRoot, "clumps", "services", "pi-hole", "config.json"),
      '{"schema_version":1}\n',
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(packageRoot, { recursive: true, force: true });
    rmSync(operatorRoot, { recursive: true, force: true });
  });

  it("resolveRepoFile finds operator config via HDC_PRIVATE_ROOT", () => {
    const env = { HDC_PRIVATE_ROOT: operatorRoot };
    const r = resolveRepoFile(shareRoot, "clumps/services/pi-hole/config.json", env);
    expect(r.found).toBe(true);
    expect(r.source).toBe("private");
    expect(r.path).toBe(join(operatorRoot, "clumps", "services", "pi-hole", "config.json"));
  });

  it("resolveRepoFile finds share example when private missing", () => {
    const env = { HDC_PRIVATE_ROOT: operatorRoot };
    const r = resolveRepoFile(
      shareRoot,
      "operations/inventory/systems/_example.json",
      env,
    );
    expect(r.found).toBe(true);
    expect(r.source).toBe("public");
  });

  it("hdcPrivateRoot auto-detects operator cwd", () => {
    expect(hdcPrivateRoot(shareRoot, {}, operatorRoot)).toBe(operatorRoot);
  });

  it("bootstrapGlobalEnv loads operator .env over platform", () => {
    writeFileSync(join(shareRoot, ".env"), "HDC_A=share\n", "utf8");
    writeFileSync(join(operatorRoot, ".env"), "HDC_A=operator\n", "utf8");
    /** @type {NodeJS.ProcessEnv} */
    const env = { HDC_PRIVATE_ROOT: operatorRoot };
    bootstrapGlobalEnv({ env, join: pathJoin }, shareRoot);
    expect(env.HDC_A).toBe("operator");
  });

  it("augmentPackageSpawnEnv sets HDC_ROOT and HDC_PRIVATE_ROOT", () => {
    const cliDir = join(packageRoot, "apps", "hdc-cli");
    mkdirSync(join(cliDir, "lib", "package"), { recursive: true });
    writeFileSync(join(cliDir, "lib", "package", "preload.mjs"), "export {};\n", "utf8");
    /** @type {NodeJS.ProcessEnv} */
    const runEnv = {
      HDC_ROOT: shareRoot,
      HDC_PRIVATE_ROOT: operatorRoot,
      HDC_PACKAGED: "1",
    };
    const out = augmentPackageSpawnEnv(runEnv, cliDir, operatorRoot);
    expect(out.HDC_ROOT).toBe(shareRoot);
    expect(out.HDC_PRIVATE_ROOT).toBe(operatorRoot);
    expect(out.HDC_PACKAGE_LIB_DIR).toContain("package");
    expect(String(out.NODE_OPTIONS)).toContain("--import=");
    expect(out.HDC_PACKAGED).toBe("1");
  });
});
