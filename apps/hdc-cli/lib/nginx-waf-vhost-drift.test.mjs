import { describe, expect, it } from "vitest";
import {
  detectVhostDrift,
  parseLiveSiteVhost,
} from "hdc/clump/services/nginx-waf/lib/nginx-waf-vhost-drift.mjs";

const drawSite = {
  id: "draw",
  host_names: ["draw.example.invalid"],
  upstream: "http://192.0.2.155:8080",
  tls: { enabled: true, cert_name: "draw.example.invalid" },
};

const vaultSite = {
  id: "vaultwarden",
  host_names: ["vault.example.invalid", "vault.home.example.invalid"],
  upstream: "http://192.0.2.123:80",
  tls: { enabled: true, cert_name: "vault.example.invalid" },
};

describe("nginx-waf vhost drift", () => {
  it("parseLiveSiteVhost extracts server_name, upstream, and listen 443", () => {
    const content = `# hdc site draw
server {
    listen 80;
    server_name draw.example.invalid;
    location / {
        proxy_pass http://192.0.2.155:8080;
    }
}
server {
    listen 443 ssl http2;
    server_name draw.example.invalid;
    ssl_certificate /etc/letsencrypt/live/draw.example.invalid/fullchain.pem;
    location / {
        proxy_pass http://192.0.2.155:8080;
    }
}
`;
    const parsed = parseLiveSiteVhost(content, "draw");
    expect(parsed.host_names).toEqual(["draw.example.invalid", "draw.example.invalid"]);
    expect(parsed.upstream).toBe("http://192.0.2.155:8080");
    expect(parsed.has_listen_443).toBe(true);
  });

  it("detects orphan hostname on wrong live vhost", () => {
    const drift = detectVhostDrift({
      configSites: [drawSite, vaultSite],
      liveSites: [
        parseLiveSiteVhost(
          `server {
    listen 443 ssl;
    server_name vault.example.invalid vault.home.example.invalid draw.example.invalid;
    location / { proxy_pass http://192.0.2.123:80; }
}`,
          "vaultwarden",
        ),
        parseLiveSiteVhost(
          `server {
    listen 80;
    server_name draw.example.invalid;
    location / { proxy_pass http://192.0.2.155:8080; }
}`,
          "draw",
        ),
      ],
      certPresent: (name) => name === "draw.example.invalid",
    });
    expect(drift.some((d) => d.kind === "orphan_hostname" && d.hostname === "draw.example.invalid")).toBe(
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
    server_name draw.example.invalid;
    location / { proxy_pass http://192.0.2.155:8080; }
}`,
          "draw",
        ),
        parseLiveSiteVhost(
          `server {
    listen 443 ssl;
    server_name vault.example.invalid vault.home.example.invalid;
    location / { proxy_pass http://192.0.2.123:80; }
}`,
          "vaultwarden",
        ),
      ],
      certPresent: () => true,
    });
    expect(drift).toEqual([]);
  });
});
