import { describe, expect, it } from "vitest";
import {
  apiTokenVaultKey,
  primaryIpFromSystem,
  resolvePiHoleWebPassword,
  webPasswordVaultKey,
} from "hdc/clump/services/pi-hole/lib/inventory.mjs";

describe("pi-hole inventory helpers", () => {
  it("reads primary ip from manual sidecar access.nodes", () => {
    expect(
      primaryIpFromSystem({
        access: { nodes: [{ name: "pi-hole-a", ip: "192.0.2.50" }] },
      }),
    ).toBe("192.0.2.50");
  });

  it("builds api token vault keys", () => {
    expect(apiTokenVaultKey({}, "a")).toBe("HDC_PIHOLE_API_TOKEN_A");
    expect(apiTokenVaultKey({}, "b")).toBe("HDC_PIHOLE_API_TOKEN_B");
    expect(apiTokenVaultKey({}, "")).toBe("HDC_PIHOLE_API_TOKEN");
  });

  it("uses configured webpassword vault key", () => {
    expect(webPasswordVaultKey({ webpassword_vault_key: "CUSTOM_PW" })).toBe("CUSTOM_PW");
    expect(webPasswordVaultKey({})).toBe("HDC_PIHOLE_WEBPASSWORD");
  });

  it("resolves webpassword from config or flag", () => {
    expect(resolvePiHoleWebPassword({ webpassword: "from-config" }, {})).toBe("from-config");
    expect(resolvePiHoleWebPassword({}, { webpassword: "from-flag" })).toBe("from-flag");
    expect(() => resolvePiHoleWebPassword({}, {})).toThrow(/webpassword required/);
  });
});
