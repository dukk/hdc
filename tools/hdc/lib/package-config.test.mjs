import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bootstrapPackageConfigFromExample,
  loadPackageConfigFromPackageRoot,
  packageConfigRel,
  tryLoadPackageConfigFromPackageRoot,
} from "./package-config.mjs";

describe("package-config", () => {
  /** @type {string} */
  let publicRoot;
  /** @type {string} */
  let privateRoot;
  /** @type {string} */
  let packageRoot;

  beforeEach(() => {
    publicRoot = mkdtempSync(join(tmpdir(), "hdc-pkg-public-"));
    privateRoot = mkdtempSync(join(tmpdir(), "hdc-pkg-private-"));
    packageRoot = join(publicRoot, "packages", "services", "bind");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "config.example.json"),
      '{"schema_version":1,"from_example":true}\n',
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(publicRoot, { recursive: true, force: true });
    rmSync(privateRoot, { recursive: true, force: true });
  });

  it("packageConfigRel returns repo-relative path", () => {
    expect(packageConfigRel(packageRoot, "config.json", publicRoot)).toBe(
      "packages/services/bind/config.json",
    );
  });

  it("loadPackageConfigFromPackageRoot loads from private fallback", () => {
    const rel = "packages/services/bind/config.json";
    mkdirSync(join(privateRoot, "packages", "services", "bind"), { recursive: true });
    writeFileSync(join(privateRoot, rel), '{"schema_version":1}\n', "utf8");

    const { data, source } = loadPackageConfigFromPackageRoot(packageRoot, {
      publicRoot,
      env: { HDC_PRIVATE_ROOT: privateRoot },
    });
    expect(source).toBe("private");
    expect(data.schema_version).toBe(1);
  });

  it("tryLoadPackageConfigFromPackageRoot returns missing when absent", () => {
    const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, {
      publicRoot,
      env: { HDC_PRIVATE_ROOT: privateRoot },
    });
    expect(loaded.ok).toBe(false);
    expect(loaded.missing).toBe(true);
  });

  it("loadPackageConfigFromPackageRoot throws when missing and bootstrapFromExample is false", () => {
    expect(() =>
      loadPackageConfigFromPackageRoot(packageRoot, {
        publicRoot,
        env: { HDC_PRIVATE_ROOT: privateRoot },
      }),
    ).toThrow(/config\.json/);
  });

  it("bootstrapFromExample creates hdc-private config and loads", () => {
    const dest = join(privateRoot, "packages", "services", "bind", "config.json");
    expect(existsSync(dest)).toBe(false);

    const { data, source } = loadPackageConfigFromPackageRoot(packageRoot, {
      publicRoot,
      env: { HDC_PRIVATE_ROOT: privateRoot },
      bootstrapFromExample: true,
    });

    expect(existsSync(dest)).toBe(true);
    expect(source).toBe("private");
    expect(data.from_example).toBe(true);
  });

  it("bootstrapFromExample does not overwrite existing config", () => {
    const rel = "packages/services/bind/config.json";
    mkdirSync(join(privateRoot, "packages", "services", "bind"), { recursive: true });
    writeFileSync(join(privateRoot, rel), '{"existing":true}\n', "utf8");

    const { data } = loadPackageConfigFromPackageRoot(packageRoot, {
      publicRoot,
      env: { HDC_PRIVATE_ROOT: privateRoot },
      bootstrapFromExample: true,
    });

    expect(data.existing).toBe(true);
    expect(JSON.parse(readFileSync(join(privateRoot, rel), "utf8")).existing).toBe(true);
  });

  it("bootstrapPackageConfigFromExample respects privateRoot for bulk bootstrap", () => {
    const destRel = "packages/services/bind/config.json";
    const exampleRel = "packages/services/bind/config.example.json";

    const result = bootstrapPackageConfigFromExample(publicRoot, destRel, exampleRel, {
      env: { HDC_PRIVATE_ROOT: privateRoot },
      privateRoot,
      log: () => {},
    });

    expect(result.action).toBe("created");
    expect(existsSync(join(privateRoot, destRel))).toBe(true);
  });

  it("tryLoadPackageConfigFromPackageRoot bootstraps when opt-in", () => {
    const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, {
      publicRoot,
      env: { HDC_PRIVATE_ROOT: privateRoot },
      bootstrapFromExample: true,
    });

    expect(loaded.ok).toBe(true);
    expect(loaded.missing).toBe(false);
    expect(loaded.data?.from_example).toBe(true);
  });
});
