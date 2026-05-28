import { describe, expect, it } from "vitest";
import {
  renderCertSyncScript,
  renderCloudflareRealIp,
  renderModsecurityMainConf,
  renderProxyHeaders,
  renderSiteVhost,
  renderTrustedGeo,
  tlsDomainsFromSites,
  validateTrustedCidrs,
} from "../../../packages/services/nginx-waf/lib/nginx-waf-render.mjs";
import { DEFAULT_TRUSTED_CIDRS } from "../../../packages/services/nginx-waf/lib/deployments.mjs";

const sampleSite = {
  id: "example-app",
  server_names: ["app.hdc.example.invalid"],
  listen: [80, 443],
  upstream: "http://192.0.2.50:8080",
  tls: { enabled: true, cert_name: "app.hdc.example.invalid" },
  waf: { enabled: true },
  locations: [{ path: "/", proxy_headers: true }],
};

const restrictedSite = {
  ...sampleSite,
  locations: [
    {
      path: "/api/",
      proxy_headers: true,
      access: { policy: "internal_only", deny_status: 404 },
    },
    {
      path: "~ ^/admin",
      proxy_headers: true,
      access: { policy: "internal_only", deny_status: 401 },
    },
    { path: "/", proxy_headers: true },
  ],
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
    expect(vhost).toContain("ssl_certificate /etc/letsencrypt/live/app.hdc.example.invalid/fullchain.pem");
    expect(vhost).toContain("/.well-known/acme-challenge/");
    expect(vhost).toContain("return 301 https://");
    expect(vhost).not.toContain("geo $remote_addr $hdc_trusted_internal");
  });

  it("renders geo and deny_status for internal_only locations", () => {
    const vhost = renderSiteVhost({
      site: restrictedSite,
      modsecurityEnabled: true,
      http01Acme: true,
      webroot: "/var/www/letsencrypt",
      trustedCidrs: ["10.0.0.0/8"],
    });
    expect(vhost).toContain("geo $remote_addr $hdc_trusted_internal {");
    expect(vhost).toContain("10.0.0.0/8 1;");
    expect(vhost).toContain("location /api/ {");
    expect(vhost).toContain("if ($hdc_trusted_internal = 0) { return 404; }");
    expect(vhost).toContain("location ~ ^/admin {");
    expect(vhost).toContain("if ($hdc_trusted_internal = 0) { return 401; }");
    expect(vhost).toContain("location / {\n        proxy_pass");
    expect(vhost).not.toContain("location / {\n        if ($hdc_trusted_internal = 0)");
  });

  it("renders Cloudflare real_ip and geo on realip_remote_addr", () => {
    const vhost = renderSiteVhost({
      site: {
        ...restrictedSite,
        client_ip: "cloudflare",
      },
      modsecurityEnabled: true,
      http01Acme: true,
      webroot: "/var/www/letsencrypt",
      trustedCidrs: DEFAULT_TRUSTED_CIDRS,
      clientIp: "cloudflare",
      cloudflareIpv4: true,
    });
    expect(vhost).toContain("geo $realip_remote_addr $hdc_trusted_internal {");
    expect(vhost).toContain("real_ip_header CF-Connecting-IP;");
    expect(vhost).toContain("set_real_ip_from 173.245.48.0/20;");
    const realIpBlocks = vhost.match(/real_ip_header CF-Connecting-IP;/g);
    expect(realIpBlocks?.length).toBe(2);
    expect(vhost).toMatch(/listen 80;[\s\S]*real_ip_header CF-Connecting-IP;/);
    expect(vhost).toMatch(/listen 443 ssl[\s\S]*real_ip_header CF-Connecting-IP;/);
  });

  it("renders X-HDC-Nginx-Waf-Node when wafNodeId is set", () => {
    const vhost = renderSiteVhost({
      site: sampleSite,
      modsecurityEnabled: true,
      http01Acme: true,
      webroot: "/var/www/letsencrypt",
      wafNodeId: "vm-nginx-waf-a",
    });
    expect(vhost).toContain("proxy_set_header X-HDC-Nginx-Waf-Node vm-nginx-waf-a;");
  });

  it("renderProxyHeaders omits node header without wafNodeId", () => {
    const headers = renderProxyHeaders({});
    expect(headers).toContain("proxy_set_header X-Real-IP $remote_addr;");
    expect(headers).not.toContain("X-HDC-Nginx-Waf-Node");
  });

  it("renderTrustedGeo uses remote_addr by default", () => {
    const geo = renderTrustedGeo({
      cidrs: ["192.168.0.0/16"],
      clientIp: "remote_addr",
    });
    expect(geo).toContain("geo $remote_addr $hdc_trusted_internal {");
    expect(geo).toContain("192.168.0.0/16 1;");
  });

  it("renderCloudflareRealIp includes CF ranges", () => {
    const snippet = renderCloudflareRealIp(true);
    expect(snippet).toContain("set_real_ip_from 104.16.0.0/13;");
    expect(snippet).toContain("real_ip_recursive on;");
  });

  it("validateTrustedCidrs rejects invalid CIDR", () => {
    expect(() => validateTrustedCidrs(["not-a-cidr"], "test")).toThrow(/invalid trusted CIDR/);
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
