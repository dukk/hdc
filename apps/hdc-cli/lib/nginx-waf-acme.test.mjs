import { describe, expect, it } from "vitest";

import {
  acmeNameInDnsZone,
  acmeNamesCoveredByZone,
  buildCertonlyCommand,
  obtainMissingCertificates,
  parseCertSanOutput,
  sansMissingFromLive,
  selectCertbotAccountId,
  defaultAcmeDirectoryUrl,
  acmeAccountStorageDir,
} from "hdc/clump/services/nginx-waf/lib/letsencrypt.mjs";
import { parseCertHaDistribute } from "hdc/clump/services/nginx-waf/lib/cert-ha.mjs";
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

describe("selectCertbotAccountId", () => {
  it("prefers the account most renewal confs already use", () => {
    expect(
      selectCertbotAccountId(
        ["ce15c0cf6012ece95b3c35c7a24ee1d5", "8822fb257b3e1daec6a0476e730efb74"],
        ["8822fb257b3e1daec6a0476e730efb74", "8822fb257b3e1daec6a0476e730efb74", "ce15c0cf6012ece95b3c35c7a24ee1d5"],
      ),
    ).toBe("8822fb257b3e1daec6a0476e730efb74");
  });

  it("falls back to a stable existing id when no renewal conf references one", () => {
    expect(selectCertbotAccountId(["b-acc", "a-acc"], [])).toBe("a-acc");
  });

  it("returns empty when the node has no accounts yet", () => {
    expect(selectCertbotAccountId([], ["ignored"])).toBe("");
  });
});

describe("defaultAcmeDirectoryUrl / acmeAccountStorageDir", () => {
  it("maps production and custom ACME URLs to certbot account paths", () => {
    expect(defaultAcmeDirectoryUrl(parseAcmeSettings({ provider: "lets_encrypt" }))).toBe(
      "https://acme-v02.api.letsencrypt.org/directory",
    );
    expect(
      acmeAccountStorageDir("https://acme-v02.api.letsencrypt.org/directory"),
    ).toBe("/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory");
    expect(
      acmeAccountStorageDir("https://ca.hdc.dukk.org/acme/acme/directory"),
    ).toBe("/etc/letsencrypt/accounts/ca.hdc.dukk.org/acme/acme/directory");
  });
});

describe("buildCertonlyCommand account flag", () => {
  it("passes --account so non-interactive certbot does not prompt when two accounts exist", () => {
    const acme = parseAcmeSettings({ provider: "lets_encrypt" });
    const cmd = buildCertonlyCommand({
      acme,
      email: "hdc@example.com",
      certName: "home.dukk.org",
      sans: ["home.dukk.org"],
      accountId: "8822fb257b3e1daec6a0476e730efb74",
    });
    expect(cmd).toContain("--account '8822fb257b3e1daec6a0476e730efb74'");
    expect(cmd).toContain("--non-interactive");
  });
});

describe("obtainMissingCertificates ACME retarget", () => {
  const groupAcme = parseAcmeSettings({ provider: "lets_encrypt", challenge: "http-01", webroot: "/var/www/letsencrypt" });
  /** @type {any} */
  const global = { acme: groupAcme, challenge: "http-01", webroot: "/var/www/letsencrypt", dnsZone: "hdc.example.invalid" };
  const log = { info: () => {} };
  const site = {
    id: "homepage",
    host_names: ["home.dukk.org"],
    tls: { enabled: true, cert_name: "home.dukk.org", certificate: { provider: "lets_encrypt", challenge: "http-01" } },
  };

  /**
   * @param {{ failCertbot?: boolean, renewalServer?: string, issuer?: string, expired?: boolean, accounts?: string[], usedAccount?: string }} opts
   */
  function createRetargetExec(opts = {}) {
    /** @type {string[]} */
    const commands = [];
    return {
      label: "mock",
      commands,
      /** @param {string} cmd */
      run(cmd) {
        commands.push(cmd);
        if (cmd.includes("openssl x509") && cmd.includes("subjectAltName")) {
          return { status: 0, stdout: "DNS:home.dukk.org", stderr: "" };
        }
        if (cmd.includes("openssl x509") && cmd.includes("-issuer")) {
          return { status: 0, stdout: opts.issuer ?? "issuer=O = DUKK HDC Internal CA, CN = Intermediate", stderr: "" };
        }
        if (cmd.includes("openssl x509") && cmd.includes("-checkend")) {
          return { status: opts.expired ? 1 : 0, stdout: "", stderr: "" };
        }
        if (cmd.startsWith("test -f /etc/letsencrypt/live/")) {
          return { status: 0, stdout: "", stderr: "" };
        }
        if (cmd.includes("awk -F=") && cmd.includes("server")) {
          return { status: 0, stdout: opts.renewalServer ?? "https://ca.hdc.dukk.org/acme/acme/directory", stderr: "" };
        }
        if (cmd.includes("ls -1") && cmd.includes("/etc/letsencrypt/accounts/")) {
          return { status: 0, stdout: (opts.accounts ?? ["ce15old", "8822new"]).join("\n"), stderr: "" };
        }
        if (cmd.includes("for f in /etc/letsencrypt/renewal")) {
          return { status: 0, stdout: `${opts.usedAccount ?? "8822new"}\n`, stderr: "" };
        }
        if (cmd.includes("certbot certonly")) {
          if (opts.failCertbot) return { status: 1, stdout: "", stderr: "Some challenges have failed." };
          return { status: 0, stdout: "Certificate obtained", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    };
  }

  it("reissues with --force-renewal and the node's own account when the lineage is still on step-ca", () => {
    const exec = createRetargetExec({});
    const result = obtainMissingCertificates({
      exec,
      log,
      global,
      email: "hdc@example.com",
      sites: [site],
    });
    expect(result).toEqual({ obtained: [], expanded: ["home.dukk.org"], skipped: [] });
    const certbot = exec.commands.find((c) => c.includes("certbot certonly"));
    expect(certbot).toContain("--force-renewal");
    expect(certbot).not.toContain("--expand");
    expect(certbot).toContain("--account '8822new'");
    expect(certbot).toContain("--webroot");
  });

  it("throws when HTTP-01 for a retargeted name fails", () => {
    const exec = createRetargetExec({ failCertbot: true });
    expect(() =>
      obtainMissingCertificates({
        exec,
        log,
        global,
        email: "hdc@example.com",
        sites: [site],
      }),
    ).toThrow(/certificate obtain failed for: home\.dukk\.org/);
  });
});

describe("parseCertHaDistribute", () => {
  it("keeps named cert copy targets", () => {
    expect(
      parseCertHaDistribute([
        { id: "mosquitto-a", host: "10.0.0.35", user: "root", cert_names: ["mqtt.hdc.dukk.org"] },
        { host: "bad", cert_names: [] },
      ]),
    ).toEqual([{ id: "mosquitto-a", host: "10.0.0.35", user: "root", certNames: ["mqtt.hdc.dukk.org"] }]);
  });
});
