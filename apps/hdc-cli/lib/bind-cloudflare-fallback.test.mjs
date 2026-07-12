import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  bindRecordKey,
  cloudflareRecordToBind,
  filterApexNsConflicts,
  loadCloudflareFallbackRecords,
  mergeCloudflareFallbackRecords,
} from "../../../clumps/services/bind/lib/bind-cloudflare-fallback.mjs";

describe("bind-cloudflare-fallback", () => {
  it("converts Cloudflare MX with priority", () => {
    const rec = cloudflareRecordToBind(
      { type: "MX", name: "@", data: "1103114483.pamx1.hotmail.com", ttl: 1, priority: 10 },
      "example.invalid",
    );
    expect(rec).toEqual({
      type: "MX",
      name: "@",
      data: "10 1103114483.pamx1.hotmail.com",
      ttl: 3600,
    });
  });

  it("local A record overrides Cloudflare A at same name", () => {
    const local = [{ type: "A", name: "vault", data: "192.0.2.99", ttl: 3600 }];
    const cf = [{ type: "A", name: "vault", data: "99.129.209.234", ttl: 3600 }];
    const merged = mergeCloudflareFallbackRecords(local, cf, "example.invalid");
    expect(merged.filter((r) => r.name === "vault")).toEqual([
      { type: "A", name: "vault", data: "192.0.2.99", ttl: 3600 },
    ]);
  });

  it("merges Cloudflare vault when not defined locally", () => {
    const local = [{ type: "A", name: "bind-a.hdc", data: "192.0.2.2", ttl: 3600 }];
    const cf = [
      { type: "A", name: "vault", data: "99.129.209.234", ttl: 3600 },
      { type: "CNAME", name: "www", data: "dukk.github.io", ttl: 3600 },
    ];
    const merged = mergeCloudflareFallbackRecords(local, cf, "example.invalid");
    expect(merged.some((r) => r.name === "vault" && r.data === "99.129.209.234")).toBe(true);
    expect(merged.some((r) => r.name === "www" && r.type === "CNAME")).toBe(true);
  });

  it("local CNAME owner blocks conflicting Cloudflare A", () => {
    const local = [{ type: "CNAME", name: "ha", data: "ha.home.example.invalid", ttl: 3600 }];
    const cf = [{ type: "A", name: "ha", data: "99.129.209.234", ttl: 3600 }];
    const merged = mergeCloudflareFallbackRecords(local, cf, "example.invalid");
    expect(merged.filter((r) => r.name === "ha")).toEqual([
      { type: "CNAME", name: "ha", data: "ha.home.example.invalid", ttl: 3600 },
    ]);
  });

  it("exclude_types skips Cloudflare NS records when loading", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-bind-cf-"));
    const cfDir = join(root, "clumps/infrastructure/cloudflare");
    mkdirSync(cfDir, { recursive: true });
    writeFileSync(
      join(cfDir, "config.json"),
      JSON.stringify({
        zones: [
          {
            name: "example.invalid",
            records: [
              { type: "NS", name: "hdc", data: "ns-a.example.invalid", ttl: 1 },
              { type: "A", name: "vault", data: "99.129.209.234", ttl: 1 },
            ],
          },
        ],
      }),
    );
    const records = loadCloudflareFallbackRecords(
      root,
      { zone: "example.invalid", config_path: "clumps/infrastructure/cloudflare/config.json" },
      "example.invalid",
    );
    expect(records.some((r) => r.type === "NS")).toBe(false);
    expect(records.some((r) => r.name === "vault")).toBe(true);
  });

  it("filterApexNsConflicts drops CNAME at apex", () => {
    const filtered = filterApexNsConflicts(
      [
        { type: "CNAME", name: "@", data: "dukk.github.io", ttl: 3600 },
        { type: "MX", name: "@", data: "10 mail.example.com", ttl: 3600 },
        { type: "A", name: "vault", data: "1.2.3.4", ttl: 3600 },
      ],
      "example.invalid",
    );
    expect(filtered.some((r) => r.type === "CNAME" && r.name === "@")).toBe(false);
    expect(filtered.some((r) => r.type === "MX" && r.name === "@")).toBe(true);
    expect(filtered.some((r) => r.name === "vault")).toBe(true);
  });

  it("bindRecordKey normalizes apex and trailing dots", () => {
    const key = bindRecordKey(
      { type: "A", name: "vault", data: "99.129.209.234", ttl: 3600 },
      "example.invalid",
    );
    expect(key).toBe("A|vault|99.129.209.234");
  });
});
