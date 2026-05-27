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

  it("renders forwarders with port syntax for local dnscrypt-proxy", () => {
    const text = renderNamedOptions({
      allowQueryCidrs: ["127.0.0.0/8"],
      recursion: true,
      forwarders: ["127.0.0.1 port 5300"],
    });
    expect(text).toContain("forwarders { 127.0.0.1 port 5300; }");
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
    expect(text).toMatch(/hypervisor-a\t3600\tIN\tA\t192\.0\.2\.11/);
    expect(text).not.toContain("hypervisor-a.hdc.example.invalid.hdc.example.invalid");
    expect(text).not.toMatch(/hypervisor-a\.hdc\.example\.invalid\t3600\tIN\tA/);
  });

  it("does not double the zone apex in hdc.dukk.org owners", () => {
    const text = renderMasterZoneFile({
      zone: "hdc.dukk.org",
      serial: "2026052501",
      primaryNs: "bind-a.hdc.dukk.org.",
      secondaryNs: "bind-b.hdc.dukk.org.",
      primaryIp: "10.0.0.2",
      secondaryIp: "10.0.0.3",
      hostmaster: "hostmaster.hdc.dukk.org",
      records: [
        { type: "A", name: "pve-b", data: "10.0.0.12", ttl: 3600 },
        { type: "CNAME", name: "ca", data: "step-ca-a.hdc.dukk.org.", ttl: 3600 },
      ],
    });
    expect(text).toMatch(/pve-b\t3600\tIN\tA\t10\.0\.0\.12/);
    expect(text).not.toContain("hdc.dukk.org.hdc.dukk.org");
    expect(text).not.toMatch(/pve-b\.hdc\.dukk\.org\t3600\tIN\tA/);
  });

  it("renders TSIG key block", () => {
    const text = renderTsigKey("dGVzdHNlY3JldA==");
    expect(text).toContain(`key "${TSIG_KEY_NAME}"`);
    expect(text).toContain("hmac-sha256");
  });
});
