import { describe, expect, it } from "vitest";
import { releaseTarballUrl } from "../../../packages/services/solidtime/lib/solidtime-install.mjs";
import { compareVersionTags } from "../../../packages/services/solidtime/lib/solidtime-maintain.mjs";

describe("solidtime release", () => {
  it("builds GitHub archive URL for a tag", () => {
    expect(releaseTarballUrl("v0.12.2")).toBe(
      "https://github.com/solidtime-io/solidtime/archive/refs/tags/v0.12.2.tar.gz",
    );
    expect(releaseTarballUrl("0.12.2")).toBe(
      "https://github.com/solidtime-io/solidtime/archive/refs/tags/v0.12.2.tar.gz",
    );
  });

  it("compareVersionTags orders releases", () => {
    expect(compareVersionTags("v0.12.2", "v0.12.1")).toBeGreaterThan(0);
    expect(compareVersionTags("v0.12.1", "v0.12.2")).toBeLessThan(0);
    expect(compareVersionTags("v0.12.2", "v0.12.2")).toBe(0);
  });
});
