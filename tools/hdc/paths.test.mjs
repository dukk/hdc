import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manuallyDeployedDir, packagesDir, repoRoot } from "./paths.mjs";

describe("paths", () => {
  it("repoRoot resolves to workspace containing packages/", () => {
    const r = repoRoot();
    expect(existsSync(join(r, "packages"))).toBe(true);
  });

  it("packagesDir joins known segment", () => {
    const r = repoRoot();
    expect(packagesDir(r)).toBe(join(r, "packages"));
  });

  it("manuallyDeployedDir joins known segment", () => {
    const r = repoRoot();
    expect(manuallyDeployedDir(r)).toBe(join(r, "docs", "manually-deployed"));
  });
});
