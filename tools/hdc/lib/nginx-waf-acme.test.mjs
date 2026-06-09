import { describe, expect, it } from "vitest";

import {
  acmeNameInDnsZone,
  acmeNamesCoveredByZone,
  buildCertonlyCommand,
} from "../../../packages/services/nginx-waf/lib/letsencrypt.mjs";
import {
  parseAcmeSettings,
  resolveSiteAcmeSettings,
} from "../../../packages/services/nginx-waf/lib/deployments.mjs";

describe("resolveSiteAcmeSettings", () => {
  it("preserves dns settings when merging parsed group ACME", () => {
    const groupParsed = parseAcmeSettings({
      challenge: "http-01",
      dns: { zone: "hdc.example.invalid", nameservers: ["10.0.0.2"] },
    });
    const resolved = resolveSiteAcmeSettings({ tls: { enabled: true } }, groupParsed);
    expect(resolved.challenge).toBe("http-01");
    expect(resolved.dnsZone).toBe("hdc.example.invalid");
    expect(resolved.dnsNameservers).toEqual(["10.0.0.2"]);
  });

  it("supports site-level dns-01 override with group dns block intact", () => {
    const groupParsed = parseAcmeSettings({
      challenge: "http-01",
      dns: { zone: "hdc.example.invalid", nameservers: ["10.0.0.2"] },
    });
    const resolved = resolveSiteAcmeSettings(
      { tls: { certificate: { challenge: "dns-01" } } },
      groupParsed,
    );
    expect(resolved.challenge).toBe("dns-01");
    expect(resolved.dnsZone).toBe("hdc.example.invalid");
    expect(resolved.dnsNameservers).toEqual(["10.0.0.2"]);
  });
});

describe("acmeNamesCoveredByZone", () => {
  const zone = "hdc.dukk.org";

  it("covers apex and subdomains of the BIND zone", () => {
    expect(acmeNameInDnsZone("hdc.dukk.org", zone)).toBe(true);
    expect(acmeNameInDnsZone("glances.hdc.dukk.org", zone)).toBe(true);
    expect(acmeNamesCoveredByZone(["immich.hdc.dukk.org"], zone)).toBe(true);
  });

  it("rejects public Cloudflare names outside BIND zone", () => {
    expect(acmeNameInDnsZone("glances.dukk.org", zone)).toBe(false);
    expect(acmeNameInDnsZone("immich.dukk.org", zone)).toBe(false);
    expect(acmeNameInDnsZone("drippylit.com", zone)).toBe(false);
    expect(acmeNameInDnsZone("mail.typotests.com", zone)).toBe(false);
    expect(acmeNamesCoveredByZone(["mail.typotests.com"], zone)).toBe(false);
    expect(acmeNamesCoveredByZone(["sign.dukk.org", "mail.typotests.com"], zone)).toBe(false);
  });
});

describe("buildCertonlyCommand", () => {
  it("includes --server and REQUESTS_CA_BUNDLE for custom ACME", () => {
    const acme = parseAcmeSettings({
      provider: "custom",
      server: "https://ca.hdc.dukk.org/acme/acme/directory",
      root_ca_path: "/etc/ssl/certs/hdc-step-ca-root.crt",
      challenge: "http-01",
      webroot: "/var/www/letsencrypt",
    });
    const cmd = buildCertonlyCommand({
      acme,
      email: "hdc@hdc.dukk.org",
      certName: "app.internal.hdc.dukk.org",
      sans: [],
    });
    expect(cmd).toContain("REQUESTS_CA_BUNDLE='/etc/ssl/certs/hdc-step-ca-root.crt'");
    expect(cmd).toContain("--server 'https://ca.hdc.dukk.org/acme/acme/directory'");
    expect(cmd).toContain("-d app.internal.hdc.dukk.org");
    expect(cmd).toContain("--webroot");
  });

  it("uses --staging for lets_encrypt when staging is true", () => {
    const acme = parseAcmeSettings({ provider: "lets_encrypt", staging: true });
    const cmd = buildCertonlyCommand({
      acme,
      email: "hdc@example.com",
      certName: "example.com",
      sans: ["example.com", "www.example.com"],
    });
    expect(cmd).toContain("--staging");
    expect(cmd).toContain("-d example.com");
    expect(cmd).toContain("-d www.example.com");
    expect(cmd).not.toContain("REQUESTS_CA_BUNDLE");
  });
});
