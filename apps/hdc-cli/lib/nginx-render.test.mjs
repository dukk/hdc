import { describe, expect, it } from "vitest";
import {
  renderSiteVhost,
  tlsDomainsFromSites,
} from "hdc/clump/services/nginx/lib/nginx-render.mjs";

const sampleSite = {
  id: "example-app",
  server_names: ["app.hdc.example.invalid"],
  listen: [80, 443],
  upstream: "http://192.0.2.50:8080",
  tls: { enabled: true, cert_name: "app.hdc.example.invalid" },
  locations: [{ path: "/", proxy_headers: true }],
};

describe("nginx render", () => {
  it("renders proxy_pass without ModSecurity for HTTPS", () => {
    const vhost = renderSiteVhost({
      site: sampleSite,
      http01Acme: true,
      webroot: "/var/www/letsencrypt",
    });
    expect(vhost).toContain("proxy_pass http://192.0.2.50:8080");
    expect(vhost).not.toContain("modsecurity");
    expect(vhost).toContain("ssl_certificate /etc/letsencrypt/live/app.hdc.example.invalid/fullchain.pem");
    expect(vhost).toContain("/.well-known/acme-challenge/");
    expect(vhost).toContain("return 301 https://");
    expect(vhost).toContain("proxy_set_header Host");
  });

  it("extracts TLS domains from sites", () => {
    expect(tlsDomainsFromSites([sampleSite])).toEqual(["app.hdc.example.invalid"]);
  });

  it("renders static HTTP site without TLS redirect", () => {
    const vhost = renderSiteVhost({
      site: {
        id: "brand-a-site",
        server_names: ["brand-a.example"],
        listen: [80],
        static: { root: "/var/www/brand-a" },
        tls: { enabled: false },
      },
      http01Acme: true,
      webroot: "/var/www/letsencrypt",
    });
    expect(vhost).toContain('root /var/www/brand-a');
    expect(vhost).toContain("try_files $uri $uri/ =404");
    expect(vhost).not.toContain("return 301 https://");
    expect(vhost).not.toContain("proxy_pass");
    expect(tlsDomainsFromSites([{ id: "brand-a-site", server_names: ["brand-a.example"], tls: { enabled: false } }])).toEqual([]);
  });
});
