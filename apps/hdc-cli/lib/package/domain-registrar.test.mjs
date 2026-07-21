import { describe, expect, it } from "vitest";

import {
  domainRecordToAutomatedInventory,
  isDomainRegistrar,
} from "./domain-registrar.mjs";

describe("isDomainRegistrar", () => {
  it("accepts objects with backendId and listDomains", () => {
    expect(
      isDomainRegistrar({
        backendId: "cloudflare",
        listDomains: async () => [],
      }),
    ).toBe(true);
  });

  it("rejects incomplete values", () => {
    expect(isDomainRegistrar(null)).toBe(false);
    expect(isDomainRegistrar({})).toBe(false);
    expect(isDomainRegistrar({ backendId: "x" })).toBe(false);
    expect(isDomainRegistrar({ listDomains: async () => [] })).toBe(false);
    expect(isDomainRegistrar({ backendId: 1, listDomains: async () => [] })).toBe(false);
  });
});

describe("domainRecordToAutomatedInventory", () => {
  it("maps DomainRecord into automated sidecar shape", () => {
    const row = domainRecordToAutomatedInventory(
      {
        apex: "Example.ORG",
        in_account: true,
        status: "active",
        zone_id: "zone-1",
        expires_at: "2027-01-15T00:00:00.000Z",
        registrar_name: "Cloudflare, Inc.",
        nameservers: ["a.ns.cloudflare.com", "b.ns.cloudflare.com"],
      },
      "cloudflare",
      "2026-07-20T00:00:00.000Z",
    );
    expect(row).toMatchObject({
      schema_version: 1,
      id: "example.org",
      kind: "domain",
      apex: "example.org",
      registrar: "cloudflare",
      in_account: true,
      expires_at: "2027-01-15T00:00:00.000Z",
      query_last: "2026-07-20T00:00:00.000Z",
      automation_targets: ["cloudflare"],
      zone_id: "zone-1",
      zone_status: "active",
      registrar_name: "Cloudflare, Inc.",
      nameservers: ["a.ns.cloudflare.com", "b.ns.cloudflare.com"],
    });
    expect(row.sources).toEqual({
      cloudflare: {
        collected_at: "2026-07-20T00:00:00.000Z",
        zone_id: "zone-1",
        zone_status: "active",
        registrar_name: "Cloudflare, Inc.",
      },
    });
  });
});
