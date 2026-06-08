import { describe, expect, it } from "vitest";
import {
  detectVhostDrift,
  parseLiveSiteVhost,
} from "../../../packages/services/nginx-waf/lib/nginx-waf-vhost-drift.mjs";

const drawSite = {
  id: "draw",
  server_names: ["draw.dukk.org"],
  upstream: "http://10.0.0.155:8080",
  tls: { enabled: true, cert_name: "draw.dukk.org" },
};

const vaultSite = {
  id: "vaultwarden",
  server_names: ["vault.dukk.org", "vault.hdc.dukk.org"],
  upstream: "http://10.0.0.123:80",
  tls: { enabled: true, cert_name: "vault.dukk.org" },
};

describe("nginx-waf vhost drift", () => {
  it("parseLiveSiteVhost extracts server_name, upstream, and listen 443", () => {
    const content = `# hdc site draw
server {
    listen 80;
    server_name draw.dukk.org;
    location / {
        proxy_pass http://10.0.0.155:8080;
    }
}
server {
    listen 443 ssl http2;
    server_name draw.dukk.org;
    ssl_certificate /etc/letsencrypt/live/draw.dukk.org/fullchain.pem;
    location / {
        proxy_pass http://10.0.0.155:8080;
    }
}
`;
    const parsed = parseLiveSiteVhost(content, "draw");
    expect(parsed.server_names).toEqual(["draw.dukk.org", "draw.dukk.org"]);
    expect(parsed.upstream).toBe("http://10.0.0.155:8080");
    expect(parsed.has_listen_443).toBe(true);
  });

  it("detects orphan hostname on wrong live vhost", () => {
    const drift = detectVhostDrift({
      configSites: [drawSite, vaultSite],
      liveSites: [
        parseLiveSiteVhost(
          `server {
    listen 443 ssl;
    server_name vault.dukk.org vault.hdc.dukk.org draw.dukk.org;
    location / { proxy_pass http://10.0.0.123:80; }
}`,
          "vaultwarden",
        ),
        parseLiveSiteVhost(
          `server {
    listen 80;
    server_name draw.dukk.org;
    location / { proxy_pass http://10.0.0.155:8080; }
}`,
          "draw",
        ),
      ],
      certPresent: (name) => name === "draw.dukk.org",
    });
    expect(drift.some((d) => d.kind === "orphan_hostname" && d.hostname === "draw.dukk.org")).toBe(
      true,
    );
    expect(drift.some((d) => d.kind === "https_missing" && d.site_id === "draw")).toBe(true);
  });

  it("reports no drift when live matches config", () => {
    const drift = detectVhostDrift({
      configSites: [drawSite, vaultSite],
      liveSites: [
        parseLiveSiteVhost(
          `server {
    listen 443 ssl;
    server_name draw.dukk.org;
    location / { proxy_pass http://10.0.0.155:8080; }
}`,
          "draw",
        ),
        parseLiveSiteVhost(
          `server {
    listen 443 ssl;
    server_name vault.dukk.org vault.hdc.dukk.org;
    location / { proxy_pass http://10.0.0.123:80; }
}`,
          "vaultwarden",
        ),
      ],
      certPresent: () => true,
    });
    expect(drift).toEqual([]);
  });
});
