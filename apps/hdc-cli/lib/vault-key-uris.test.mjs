import { describe, expect, it } from "vitest";

import {
  buildAllVaultKeyUris,
  normalizeServiceUrl,
  shouldSkipVaultKeyUri,
  sortVaultKeyUris,
  urlFromHostPort,
  vaultKeyUrisEqual,
} from "./vault-key-uris.mjs";

describe("vault-key-uris", () => {
  it("normalizeServiceUrl rejects placeholders and accepts https URLs", () => {
    expect(normalizeServiceUrl("https://n8n.hdc.dukk.org")).toBe("https://n8n.hdc.dukk.org");
    expect(normalizeServiceUrl("vault.dukk.org")).toBe("https://vault.dukk.org");
    expect(normalizeServiceUrl("https://newsletter.example.invalid")).toBeNull();
    expect(normalizeServiceUrl("https://s3.REPLACE_DOMAIN")).toBeNull();
  });

  it("urlFromHostPort builds LAN URLs", () => {
    expect(urlFromHostPort("192.0.2.125", 9120)).toBe("http://192.0.2.125:9120");
    expect(urlFromHostPort("bad", 80)).toBeNull();
  });

  it("shouldSkipVaultKeyUri skips infra-only keys", () => {
    expect(shouldSkipVaultKeyUri("HDC_CLOUDFLARE_API_TOKEN")).toBe(true);
    expect(shouldSkipVaultKeyUri("HDC_USER_HDC_PASSWORD_HDC_RUNNER_A")).toBe(true);
    expect(shouldSkipVaultKeyUri("HDC_UPTIME_KUMA_PASSWORD")).toBe(false);
    expect(shouldSkipVaultKeyUri("HDC_STIRLING_PDF_ADMIN_PASSWORD")).toBe(false);
  });

  it("sortVaultKeyUris prefers public hostnames before LAN IPs", () => {
    expect(
      sortVaultKeyUris(["http://192.0.2.125:9120", "https://paperclip.hdc.dukk.org"]),
    ).toEqual(["https://paperclip.hdc.dukk.org", "http://192.0.2.125:9120"]);
  });

  it("vaultKeyUrisEqual compares sorted unique lists", () => {
    expect(vaultKeyUrisEqual(["https://b", "https://a"], ["https://a", "https://b"])).toBe(true);
    expect(vaultKeyUrisEqual(["https://a"], ["https://a", "https://b"])).toBe(false);
  });

  it("buildAllVaultKeyUris resolves service URLs from live private config when present", () => {
    const map = buildAllVaultKeyUris(undefined, process.env);
    expect(map.size).toBeGreaterThan(0);

    const proxmox = map.get("HDC_PROXMOX_API_TOKEN");
    if (proxmox) {
      expect(proxmox.some((u) => u.includes("8006"))).toBe(true);
    }

    const kuma = map.get("HDC_UPTIME_KUMA_PASSWORD");
    if (kuma) {
      expect(kuma.some((u) => u.startsWith("https://"))).toBe(true);
    }

    const runner = map.get("HDC_HDC_RUNNER_UI_PASSWORD");
    if (runner) {
      expect(runner.some((u) => u.startsWith("http://10."))).toBe(true);
    }
  });
});
