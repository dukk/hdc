import { describe, expect, it } from "vitest";
import {
  allowlistFromPiholeConfig,
  buildAllowlistSyncScript,
  isValidAllowlistDomain,
  normalizeDomain,
  parseAllowlistListOutput,
} from "hdc/clump/services/pi-hole/lib/pi-hole-allowlist.mjs";

describe("pi-hole allowlist", () => {
  it("normalizes and dedupes allowlist config entries", () => {
    const entries = allowlistFromPiholeConfig({
      allowlist: [
        "MarketingPlatform.Google.com",
        "marketingplatform.google.com",
        { domain: "WWW.Google-Analytics.com", comment: "GA" },
      ],
    });
    expect(entries).toEqual([
      { domain: "marketingplatform.google.com" },
      { domain: "www.google-analytics.com", comment: "GA" },
    ]);
  });

  it("rejects invalid allowlist domains", () => {
    expect(() => allowlistFromPiholeConfig({ allowlist: ["*.google.com"] })).toThrow(
      /invalid allowlist domain/,
    );
    expect(isValidAllowlistDomain("not a domain")).toBe(false);
    expect(isValidAllowlistDomain("example.com")).toBe(true);
    expect(normalizeDomain(" Example.COM ")).toBe("example.com");
  });

  it("parses allowlist list output", () => {
    const stdout = [
      ' ✓ Found 2 domain(s) in the exact allowlist:',
      ' - "marketingplatform.google.com"',
      ' Comment: "GA admin"',
      ' - "www.googletagmanager.com"',
    ].join("\n");
    expect(parseAllowlistListOutput(stdout)).toEqual([
      "marketingplatform.google.com",
      "www.googletagmanager.com",
    ]);
  });

  it("builds add-only sync script", () => {
    const built = buildAllowlistSyncScript(
      [{ domain: "marketingplatform.google.com" }, { domain: "analytics.google.com" }],
      { liveDomains: ["analytics.google.com"] },
    );
    expect(built.noop).toBe(false);
    expect(built.added).toEqual(["marketingplatform.google.com"]);
    expect(built.removed).toEqual([]);
    expect(built.script).toContain("pihole allow -q 'marketingplatform.google.com'");
    expect(built.script).not.toContain("remove");
  });

  it("builds prune sync script", () => {
    const built = buildAllowlistSyncScript([{ domain: "marketingplatform.google.com" }], {
      prune: true,
      liveDomains: ["marketingplatform.google.com", "old.example.com"],
    });
    expect(built.added).toEqual([]);
    expect(built.removed).toEqual(["old.example.com"]);
    expect(built.script).toContain("pihole allow remove -q 'old.example.com'");
  });

  it("returns noop when config already matches live allowlist", () => {
    const built = buildAllowlistSyncScript([{ domain: "marketingplatform.google.com" }], {
      liveDomains: ["marketingplatform.google.com"],
    });
    expect(built.noop).toBe(true);
    expect(built.script).toBeNull();
  });

  it("skips script generation when allowlist empty and not pruning", () => {
    const built = buildAllowlistSyncScript([], { liveDomains: ["manual.example.com"] });
    expect(built.noop).toBe(true);
    expect(built.removed).toEqual([]);
  });
});
