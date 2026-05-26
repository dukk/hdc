import { describe, expect, it } from "vitest";
import {
  MODSECURITY_RULES_FILE,
  renderCertSyncScript,
  renderModsecurityMainConf,
  renderSiteVhost,
  tlsDomainsFromSites,
} from "../../../packages/services/nginx-waf/lib/nginx-waf-render.mjs";

const sampleSite = {
  id: "example-app",
  server_names: ["app.hdc.example.invalid"],
  listen: [80, 443],
  upstream: "http://192.0.2.50:8080",
  tls: { enabled: true, cert_name: "app.hdc.example.invalid" },
  waf: { enabled: true },
  locations: [{ path: "/", proxy_headers: true }],
};

describe("nginx-waf render", () => {
  it("renders proxy_pass and ModSecurity for HTTPS", () => {
    const vhost = renderSiteVhost({
      site: sampleSite,
      modsecurityEnabled: true,
      http01Acme: true,
      webroot: "/var/www/letsencrypt",
    });
    expect(vhost).toContain("proxy_pass http://192.0.2.50:8080");
    expect(vhost).toContain("modsecurity on");
    expect(vhost).toContain(MODSECURITY_RULES_FILE);
    expect(vhost).toContain("ssl_certificate /etc/letsencrypt/live/app.hdc.example.invalid/fullchain.pem");
    expect(vhost).toContain("/.well-known/acme-challenge/");
    expect(vhost).toContain("return 301 https://");
  });

  it("extracts TLS domains from sites", () => {
    expect(tlsDomainsFromSites([sampleSite])).toEqual(["app.hdc.example.invalid"]);
  });

  it("renders ModSecurity main conf with OWASP CRS includes", () => {
    const conf = renderModsecurityMainConf({
      ruleEngine: "On",
      crsSetup: "/etc/modsecurity/crs/crs-setup.conf",
      crsRulesGlob: "/usr/share/modsecurity-crs/rules/*.conf",
      unicodeMap: "/usr/share/modsecurity-crs/unicode.mapping",
      auditLog: "/var/log/nginx/modsec_audit.log",
    });
    expect(conf).toContain("SecRuleEngine On");
    expect(conf).toContain("Include /etc/modsecurity/crs/crs-setup.conf");
    expect(conf).toContain("Include /usr/share/modsecurity-crs/rules/*.conf");
    expect(conf).toContain("SecUnicodeMapFile /usr/share/modsecurity-crs/unicode.mapping");
  });

  it("renders cert sync script with peer target", () => {
    const script = renderCertSyncScript({ peerUser: "root", peerHost: "192.0.2.21" });
    expect(script).toContain("root@192.0.2.21");
    expect(script).toContain("rsync");
    expect(script).toContain("nginx -s reload");
  });
});
