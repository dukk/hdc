import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildZoneBundle,
  collectForwardARecords,
  mergeReverseRecords,
  parseIpv4Cidr,
  ptrOwnerForIp,
  soaSerialFromTimestamp,
  validateZoneRecords,
} from "../../../clumps/services/bind/lib/bind-zones.mjs";

describe("bind-zones", () => {
  it("parses IPv4 CIDR", () => {
    const p = parseIpv4Cidr("192.0.2.0/24");
    expect(p).not.toBeNull();
    expect(p?.prefix).toBe(24);
  });

  it("builds PTR owner from IP", () => {
    expect(ptrOwnerForIp("192.0.2.2")).toBe("2.2.0");
    expect(ptrOwnerForIp("198.51.100.5")).toBe("5.100.51");
  });

  it("merges auto PTR from forward A in subnet", () => {
    const zones = {
      "hdc.example.invalid": {
        zone_type: "forward",
        records: [{ type: "A", name: "hypervisor-a", data: "192.0.2.11" }],
      },
      "2.0.192.in-addr.arpa": {
        zone_type: "reverse",
        subnet: "192.0.2.0/24",
        records: [],
      },
    };
    const forwardAs = collectForwardARecords(zones);
    const merged = mergeReverseRecords(zones["2.0.192.in-addr.arpa"], forwardAs);
    expect(merged.some((r) => r.name === "11.2.0" && r.data.includes("hypervisor-a"))).toBe(true);
  });

  it("uses timestamp SOA serial YYYYMMDDnn (fits BIND uint31)", () => {
    const serial = soaSerialFromTimestamp(new Date("2026-05-25T14:30:00Z"));
    expect(serial).toBe("2026052570");
    expect(serial).toMatch(/^\d{10}$/);
    expect(Number(serial)).toBeLessThanOrEqual(2_147_483_647);
  });

  it("validateZoneRecords rejects CNAME coexisting with other types at same owner", () => {
    expect(() =>
      validateZoneRecords(
        [
          { type: "A", name: "ca", data: "192.0.2.8", ttl: 3600 },
          { type: "CNAME", name: "ca", data: "step-ca-a.example.", ttl: 3600 },
        ],
        "hdc.example.invalid",
      ),
    ).toThrow(/CNAME cannot coexist/);
  });

  it("buildZoneBundle uses provided serial for all zones", () => {
    const zoneMap = {
      "hdc.example.invalid": {
        zone_type: "forward",
        records: [{ type: "A", name: "x", data: "192.0.2.1" }],
      },
    };
    const ns = {
      primaryNs: "dns-a.hdc.example.invalid",
      secondaryNs: "dns-b.hdc.example.invalid",
      primaryIp: "192.0.2.2",
      secondaryIp: "192.0.2.3",
      hostmaster: "hostmaster.hdc.example.invalid",
    };
    const { bundles } = buildZoneBundle(["hdc.example.invalid"], zoneMap, ns, { serial: "2026052570" });
    expect(bundles).toHaveLength(1);
    expect(bundles[0].serial).toBe("2026052570");
    expect(bundles[0].records).toHaveLength(1);
  });

  it("buildZoneBundle merges cloudflare_fallback when repoRoot is set", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-bind-zones-cf-"));
    const cfDir = join(root, "clumps/infrastructure/cloudflare");
    mkdirSync(cfDir, { recursive: true });
    writeFileSync(
      join(cfDir, "config.json"),
      JSON.stringify({
        zones: [
          {
            name: "example.invalid",
            records: [
              { type: "A", name: "vault", data: "198.51.100.10", ttl: 1 },
              { type: "NS", name: "hdc", data: "ns-a.example.invalid", ttl: 1 },
            ],
          },
        ],
      }),
    );
    const zoneMap = {
      "example.invalid": {
        zone_type: "forward",
        cloudflare_fallback: { zone: "example.invalid" },
        records: [{ type: "A", name: "local-only", data: "192.0.2.50", ttl: 3600 }],
      },
    };
    const ns = {
      primaryNs: "dns-a.hdc.example.invalid.",
      secondaryNs: "dns-b.hdc.example.invalid.",
      primaryIp: "192.0.2.2",
      secondaryIp: "192.0.2.3",
      hostmaster: "hostmaster.hdc.example.invalid",
    };
    const { bundles } = buildZoneBundle(["example.invalid"], zoneMap, ns, {
      serial: "2026052570",
      repoRoot: root,
    });
    expect(bundles[0].records.some((r) => r.name === "local-only")).toBe(true);
    expect(bundles[0].records.some((r) => r.name === "vault" && r.data === "198.51.100.10")).toBe(true);
    expect(bundles[0].records.some((r) => r.type === "NS")).toBe(false);
  });
});
