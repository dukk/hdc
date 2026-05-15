import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { automationDir, inventoryAutomatedDir, inventoryManualDir, manuallyDeployedDir, repoRoot } from "./paths.mjs";

describe("paths", () => {
  it("repoRoot resolves to workspace containing automation/", () => {
    const r = repoRoot();
    expect(existsSync(join(r, "automation"))).toBe(true);
  });

  it("automationDir joins known segment", () => {
    const r = repoRoot();
    expect(automationDir(r)).toBe(join(r, "automation"));
  });

  it("manuallyDeployedDir joins known segment", () => {
    const r = repoRoot();
    expect(manuallyDeployedDir(r)).toBe(join(r, "docs", "manually-deployed"));
  });

  it("inventoryManualDir and inventoryAutomatedDir join known segments", () => {
    const r = repoRoot();
    expect(inventoryManualDir(r)).toBe(join(r, "inventory", "manual"));
    expect(inventoryAutomatedDir(r)).toBe(join(r, "inventory", "automated"));
  });
});
