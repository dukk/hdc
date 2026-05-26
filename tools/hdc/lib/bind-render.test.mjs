import { describe, expect, it } from "vitest";
import {
  renderMasterZoneFile,
  renderNamedLocal,
  renderNamedOptions,
  renderTsigKey,
  TSIG_KEY_NAME,
} from "../../../packages/services/bind/lib/bind-render.mjs";

describe("bind-render", () => {
  it("renders named options with ACLs", () => {
    const text = renderNamedOptions({
      allowQueryCidrs: ["192.0.2.0/24"],
      recursion: true,
      dnssecValidation: false,
    });
    expect(text).toContain("allow-query");
    expect(text).toContain("192.0.2.0/24");
    expect(text).toContain("recursion yes");
    expect(text).toContain("dnssec-validation no");
  });

  it("renders primary zone local stanzas with transfer key", () => {
    const text = renderNamedLocal({
      role: "primary",
      zoneIds: ["hdc.example.invalid"],
      primaryIp: "192.0.2.2",
      secondaryIp: "192.0.2.3",
    });
    expect(text).toContain('zone "hdc.example.invalid"');
    expect(text).toContain("type master");
    expect(text).toContain(TSIG_KEY_NAME);
    expect(text).toContain("also-notify { 192.0.2.3");
  });

  it("renders secondary slave stanzas", () => {
    const text = renderNamedLocal({
      role: "secondary",
      zoneIds: ["hdc.example.invalid"],
      primaryIp: "192.0.2.2",
      secondaryIp: "192.0.2.3",
    });
    expect(text).toContain("type slave");
    expect(text).toContain("masters { 192.0.2.2");
  });

  it("renders master zone with SOA and NS", () => {
    const text = renderMasterZoneFile({
      zone: "hdc.example.invalid",
      serial: "2026052501",
      primaryNs: "dns-a.hdc.example.invalid",
      secondaryNs: "dns-b.hdc.example.invalid",
      primaryIp: "192.0.2.2",
      secondaryIp: "192.0.2.3",
      hostmaster: "hostmaster.hdc.example.invalid",
      records: [{ type: "A", name: "hypervisor-a", data: "192.0.2.11", ttl: 3600 }],
    });
    expect(text).toContain("IN\tSOA");
    expect(text).toContain("2026052501");
    expect(text).toContain("hypervisor-a.hdc.example.invalid");
    expect(text).toContain("192.0.2.11");
  });

  it("renders TSIG key block", () => {
    const text = renderTsigKey("dGVzdHNlY3JldA==");
    expect(text).toContain(`key "${TSIG_KEY_NAME}"`);
    expect(text).toContain("hmac-sha256");
  });
});
