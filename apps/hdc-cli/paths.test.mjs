import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manuallyDeployedDir, defaultClumpsCacheDir, repoRoot } from "./paths.mjs";
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
