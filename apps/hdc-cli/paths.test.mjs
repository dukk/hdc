import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manuallyDeployedDir, clumpsDir, repoRoot } from "./paths.mjs";

describe("paths", () => {
  it("repoRoot resolves to workspace containing clumps/", () => {
    const r = repoRoot();
    expect(existsSync(join(r, "clumps"))).toBe(true);
  });

  it("clumpsDir joins known segment", () => {
    const r = repoRoot();
    expect(clumpsDir(r)).toBe(join(r, "clumps"));
  });

  it("manuallyDeployedDir joins known segment", () => {
    const r = repoRoot();
    expect(manuallyDeployedDir(r)).toBe(join(r, "docs", "manually-deployed"));
  });
});
