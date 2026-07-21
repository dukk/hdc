import { describe, expect, it } from "vitest";

import {
  acmeNameInDnsZone,
  acmeNamesCoveredByZone,
  buildCertonlyCommand,
  obtainMissingCertificates,
  parseCertSanOutput,
  sansMissingFromLive,
} from "hdc/clump/services/nginx-waf/lib/letsencrypt.mjs";
import {
  parseAcmeSettings,
  resolveSiteAcmeSettings,
} from "hdc/clump/services/nginx-waf/lib/deployments.mjs";

describe("resolveSiteAcmeSettings", () => {
  it("preserves dns settings when merging parsed group ACME", () => {
    const groupParsed = parseAcmeSettings({
      challenge: "http-01",
      dns: { zone: "hdc.example.invalid", nameservers: ["192.0.2.2"] },
    });
    const resolved = resolveSiteAcmeSettings({ tls: { enabled: true } }, groupParsed);
    expect(resolved.challenge).toBe("http-01");
    expect(resolved.dnsZone).toBe("hdc.example.invalid");
    expect(resolved.dnsNameservers).toEqual(["192.0.2.2"]);
  });

  it("supports site-level dns-01 override with group dns block intact", () => {
    const groupParsed = parseAcmeSettings({
      challenge: "http-01",
      dns: { zone: "hdc.example.invalid", nameservers: ["192.0.2.2"] },
    });
    const resolved = resolveSiteAcmeSettings(
      { tls: { certificate: { challenge: "dns-01" } } },
      groupParsed,
    );
    expect(resolved.challenge).toBe("dns-01");
    expect(resolved.dnsZone).toBe("hdc.example.invalid");
    expect(resolved.dnsNameservers).toEqual(["192.0.2.2"]);
  });
});

describe("acmeNamesCoveredByZone", () => {
  const zone = "hdc.example.invalid";

  it("covers apex and subdomains of the BIND zone", () => {
    expect(acmeNameInDnsZone("hdc.example.invalid", zone)).toBe(true);
    expect(acmeNameInDnsZone("glances.hdc.example.invalid", zone)).toBe(true);
    expect(acmeNamesCoveredByZone(["immich.hdc.example.invalid"], zone)).toBe(true);
  });

  it("rejects public Cloudflare names outside BIND zone", () => {
    expect(acmeNameInDnsZone("glances.example.invalid", zone)).toBe(false);
    expect(acmeNameInDnsZone("immich.example.invalid", zone)).toBe(false);
    expect(acmeNameInDnsZone("brand-a.example", zone)).toBe(false);
    expect(acmeNameInDnsZone("mail.brand-b.example", zone)).toBe(false);
    expect(acmeNamesCoveredByZone(["mail.brand-b.example"], zone)).toBe(false);
    expect(acmeNamesCoveredByZone(["sign.example.invalid", "mail.brand-b.example"], zone)).toBe(false);
  });
});

describe("parseCertSanOutput / sansMissingFromLive", () => {
  it("parses DNS SANs from openssl subjectAltName output", () => {
    expect(
      parseCertSanOutput(
        "X509v3 Subject Alternative Name:\n    DNS:mail.a.example, DNS:mail.b.example\n",
      ),
    ).toEqual(["mail.a.example", "mail.b.example"]);
  });

  it("reports desired names missing from live SANs case-insensitively", () => {
    expect(
      sansMissingFromLive(
        ["mail.A.example", "mail.b.example", "mail.c.example"],
        ["mail.a.example", "mail.b.example"],
      ),
    ).toEqual(["mail.c.example"]);
  });
});

describe("buildCertonlyCommand", () => {
  it("includes --server and REQUESTS_CA_BUNDLE for custom ACME", () => {
    const acme = parseAcmeSettings({
      provider: "custom",
      server: "https://ca.home.example.invalid/acme/acme/directory",
      root_ca_path: "/etc/ssl/certs/hdc-step-ca-root.crt",
      challenge: "http-01",
      webroot: "/var/www/letsencrypt",
    });
    const cmd = buildCertonlyCommand({
      acme,
      email: "hdc@hdc.example.invalid",
      certName: "app.internal.home.example.invalid",
      sans: [],
    });
    expect(cmd).toContain("REQUESTS_CA_BUNDLE='/etc/ssl/certs/hdc-step-ca-root.crt'");
    expect(cmd).toContain("--server 'https://ca.home.example.invalid/acme/acme/directory'");
    expect(cmd).toContain("-d app.internal.home.example.invalid");
    expect(cmd).toContain("--cert-name 'app.internal.home.example.invalid'");
    expect(cmd).toContain("--expand");
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
    expect(cmd).toContain("--cert-name 'example.com'");
    expect(cmd).toContain("--expand");
    expect(cmd).toContain("-d example.com");
    expect(cmd).toContain("-d www.example.com");
    expect(cmd).not.toContain("REQUESTS_CA_BUNDLE");
  });
});

describe("obtainMissingCertificates SAN expand", () => {
  const acme = parseAcmeSettings({
    challenge: "http-01",
    webroot: "/var/www/letsencrypt",
  });
  /** @type {any} */
  const global = { acme, challenge: "http-01", webroot: "/var/www/letsencrypt" };
  const log = { info: () => {} };
  const site = {
    id: "mailcow",
    host_names: ["mail.a.example", "mail.b.example", "mail.c.example"],
    tls: { enabled: true, cert_name: "mail.a.example" },
  };

  /**
   * @param {{ exists?: boolean; liveSans?: string[]; failCertbot?: boolean }} opts
   */
  function createExec(opts = {}) {
    const exists = opts.exists !== false;
    const liveSans = opts.liveSans ?? ["mail.a.example", "mail.b.example"];
    /** @type {string[]} */
    const commands = [];
    return {
      label: "mock",
      commands,
      /** @param {string} cmd */
      run(cmd) {
        commands.push(cmd);
        if (cmd.includes("openssl x509") && cmd.includes("subjectAltName")) {
          if (!exists) return { status: 1, stdout: "", stderr: "" };
          const stdout = liveSans.map((n) => `DNS:${n}`).join(", ");
          return { status: 0, stdout, stderr: "" };
        }
        if (cmd.startsWith("test -f /etc/letsencrypt/live/")) {
          return { status: exists ? 0 : 1, stdout: "", stderr: "" };
        }
        if (cmd.includes("certbot certonly")) {
          if (opts.failCertbot) {
            return { status: 1, stdout: "", stderr: "certbot failed" };
          }
          return { status: 0, stdout: "Certificate obtained", stderr: "" };
        }
        if (cmd.includes("mkdir -p")) {
          return { status: 0, stdout: "", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    };
  }

  it("skips when live SANs already cover configured host_names", () => {
    const exec = createExec({
      exists: true,
      liveSans: ["mail.a.example", "mail.b.example", "mail.c.example"],
    });
    const result = obtainMissingCertificates({
      exec,
      log,
      global,
      email: "hdc@example.com",
      sites: [site],
    });
    expect(result).toEqual({ obtained: [], expanded: [], skipped: ["mail.a.example"] });
    expect(exec.commands.some((c) => c.includes("certbot certonly"))).toBe(false);
  });

  it("expands when cert exists but SANs are incomplete", () => {
    const exec = createExec({
      exists: true,
      liveSans: ["mail.a.example", "mail.b.example"],
    });
    const result = obtainMissingCertificates({
      exec,
      log,
      global,
      email: "hdc@example.com",
      sites: [site],
    });
    expect(result).toEqual({ obtained: [], expanded: ["mail.a.example"], skipped: [] });
    const certbot = exec.commands.find((c) => c.includes("certbot certonly"));
    expect(certbot).toBeTruthy();
    expect(certbot).toContain("--cert-name 'mail.a.example'");
    expect(certbot).toContain("--expand");
    expect(certbot).toContain("-d mail.c.example");
  });

  it("obtains when cert file is missing", () => {
    const exec = createExec({ exists: false });
    const result = obtainMissingCertificates({
      exec,
      log,
      global,
      email: "hdc@example.com",
      sites: [site],
    });
    expect(result).toEqual({ obtained: ["mail.a.example"], expanded: [], skipped: [] });
    expect(exec.commands.some((c) => c.includes("certbot certonly"))).toBe(true);
  });
});
