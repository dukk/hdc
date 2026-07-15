import { describe, expect, it } from "vitest";
import {
  renderMasterZoneFile,
  renderNamedLocal,
  renderNamedLogging,
  renderNamedOptions,
  renderTsigKey,
  TSIG_KEY_NAME,
} from "hdc/clump/services/bind/lib/bind-render.mjs";

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

  it("renders logging config that suppresses security and query categories", () => {
    const text = renderNamedLogging();
    expect(text).toContain("logging {");
    expect(text).toContain("category security { null; };");
    expect(text).toContain("category queries { null; };");
    expect(text).toContain("category query-errors { null; };");
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

  it("does not double the zone apex in hdc.example.invalid owners", () => {
    const text = renderMasterZoneFile({
      zone: "hdc.example.invalid",
      serial: "2026052501",
      primaryNs: "bind-a.home.example.invalid.",
      secondaryNs: "bind-b.home.example.invalid.",
      primaryIp: "192.0.2.2",
      secondaryIp: "192.0.2.3",
      hostmaster: "hostmaster.home.example.invalid",
      records: [
        { type: "A", name: "pve-b", data: "192.0.2.12", ttl: 3600 },
        { type: "CNAME", name: "ca", data: "step-ca-a.home.example.invalid.", ttl: 3600 },
      ],
    });
    expect(text).toMatch(/pve-b\t3600\tIN\tA\t192\.0\.2\.12/);
    expect(text).not.toContain("hdc.example.invalid.home.example.invalid");
    expect(text).not.toMatch(/pve-b\.hdc\.example\.invalid\t3600\tIN\tA/);
  });

  it("renders TSIG key block", () => {
    const text = renderTsigKey("dGVzdHNlY3JldA==");
    expect(text).toContain(`key "${TSIG_KEY_NAME}"`);
    expect(text).toContain("hmac-sha256");
  });

  it("renders NS glue labels relative to zone apex", () => {
    const text = renderMasterZoneFile({
      zone: "dukk.org",
      serial: "2026070201",
      primaryNs: "bind-a.hdc.dukk.org.",
      secondaryNs: "bind-b.hdc.dukk.org.",
      primaryIp: "192.0.2.2",
      secondaryIp: "192.0.2.3",
      hostmaster: "hostmaster.hdc.dukk.org",
      records: [],
    });
    expect(text).toMatch(/bind-a\.hdc\t3600\tIN\tA\t192\.0\.2\.2/);
    expect(text).toMatch(/bind-b\.hdc\t3600\tIN\tA\t192\.0\.2\.3/);
    expect(text).not.toMatch(/\nbind-a\t3600\tIN\tA\t192\.0\.2\.2/);
    expect(text).not.toMatch(/\nbind-b\t3600\tIN\tA\t192\.0\.2\.3/);
  });

  it("renders TXT and CNAME without mangling TXT rdata", () => {
    const text = renderMasterZoneFile({
      zone: "hdc.example.invalid",
      serial: "2026060801",
      primaryNs: "bind-a.home.example.invalid.",
      secondaryNs: "bind-b.home.example.invalid.",
      primaryIp: "192.0.2.2",
      secondaryIp: "192.0.2.3",
      hostmaster: "hostmaster.home.example.invalid",
      records: [
        {
          type: "TXT",
          name: "@",
          data: "\"v=spf1 include:spf.smtp2go.com ~all\"",
          ttl: 3600,
        },
        {
          type: "CNAME",
          name: "s1160987._domainkey",
          data: "dkim.smtp2go.net.",
          ttl: 3600,
        },
      ],
    });
    expect(text).toContain('IN\tTXT\t"v=spf1 include:spf.smtp2go.com ~all"');
    expect(text).not.toContain("~all\".");
    expect(text).toContain("s1160987._domainkey\t3600\tIN\tCNAME\tdkim.smtp2go.net.");
  });
});
