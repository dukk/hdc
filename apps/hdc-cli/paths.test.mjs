import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cliAppDir,
  defaultClumpsCacheDir,
  isPackagedMode,
  manuallyDeployedDir,
  platformRoot,
  repoRoot,
  workspaceRoot,
} from "./paths.mjs";
import { primaryClumpsRoot } from "./manifests.mjs";

describe("paths", () => {
  it("repoRoot resolves to workspace containing apps/hdc-cli", () => {
    const r = repoRoot();
    expect(existsSync(join(r, "apps", "hdc-cli"))).toBe(true);
  });

  it("primaryClumpsRoot points at external hdc-clumps or cache", () => {
    const r = repoRoot();
    const root = primaryClumpsRoot(r);
    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, "services"))).toBe(true);
  });

  it("manuallyDeployedDir joins known segment", () => {
    const r = repoRoot();
    expect(manuallyDeployedDir(r)).toBe(join(r, "docs", "manually-deployed"));
  });

  it("defaultClumpsCacheDir is under user home", () => {
    const dir = defaultClumpsCacheDir();
    expect(dir).toMatch(/clump-repos$/);
  });
});

describe("paths packaged mode", () => {
  it("isPackagedMode is false in git checkout", () => {
    expect(isPackagedMode({})).toBe(false);
    expect(isPackagedMode({ HDC_PACKAGED: "1" })).toBe(true);
    expect(isPackagedMode({ HDC_PACKAGED: "0" })).toBe(false);
  });

  it("platformRoot / repoRoot point at hdc git root by default", () => {
    const r = platformRoot({});
    expect(existsSync(join(r, "apps", "hdc-cli", "paths.mjs"))).toBe(true);
    expect(repoRoot({})).toBe(r);
  });

  it("cliAppDir is apps/hdc-cli in git layout", () => {
    const dir = cliAppDir(platformRoot({}), {});
    expect(existsSync(join(dir, "paths.mjs"))).toBe(true);
    expect(dir.replace(/\\/g, "/")).toMatch(/apps\/hdc-cli$/);
  });

  it("HDC_ROOT overrides platformRoot when path exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hdc-root-"));
    try {
      expect(platformRoot({ HDC_ROOT: tmp })).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("workspaceRoot uses HDC_PRIVATE_ROOT", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hdc-ws-"));
    try {
      expect(workspaceRoot({ HDC_PRIVATE_ROOT: tmp }, tmp)).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("HDC_PACKAGED=1 uses share/ as platformRoot when present", () => {
    const r = platformRoot({ HDC_PACKAGED: "1" });
    expect(r.replace(/\\/g, "/")).toMatch(/share$/);
    expect(cliAppDir(r, { HDC_PACKAGED: "1" }).replace(/\\/g, "/")).toMatch(
      /apps\/hdc-cli$/,
    );
  });
});
