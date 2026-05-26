import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
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
});
