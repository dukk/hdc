import { describe, expect, it } from "vitest";
import {
  buildZoneBundle,
  collectForwardARecords,
  mergeReverseRecords,
  parseIpv4Cidr,
  ptrOwnerForIp,
  soaSerialFromTimestamp,
} from "../../../packages/services/bind/lib/bind-zones.mjs";

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
});
