import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isLatestReleaseSpec,
  normalizeReleaseTag,
  parseGithubLatestRelease,
  releaseTarballUrl,
} from "../../../clumps/services/uptime-kuma/lib/uptime-kuma-release.mjs";

describe("uptime-kuma release", () => {
  it("normalizes tags with optional v prefix", () => {
    expect(normalizeReleaseTag("v2.3.2")).toBe("2.3.2");
    expect(normalizeReleaseTag("2.3.2")).toBe("2.3.2");
  });

  it("builds GitHub archive tarball URL", () => {
    expect(releaseTarballUrl("2.3.2")).toBe(
      "https://github.com/louislam/uptime-kuma/archive/refs/tags/2.3.2.tar.gz",
    );
  });

  it("detects latest release spec", () => {
    expect(isLatestReleaseSpec("latest")).toBe(true);
    expect(isLatestReleaseSpec("")).toBe(true);
    expect(isLatestReleaseSpec("2.3.2")).toBe(false);
  });

  it("parses GitHub latest release JSON", () => {
    const parsed = parseGithubLatestRelease({ tag_name: "2.3.2" });
    expect(parsed.tag).toBe("2.3.2");
    expect(parsed.tarballUrl).toContain("2.3.2.tar.gz");
  });

  it("compareVersions orders semver tuples", () => {
    expect(compareVersions("2.3.1", "2.3.2")).toBe(-1);
    expect(compareVersions("2.3.2", "2.3.2")).toBe(0);
    expect(compareVersions("2.4.0", "2.3.2")).toBe(1);
  });
});
