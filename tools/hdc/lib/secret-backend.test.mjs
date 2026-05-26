import { describe, expect, it } from "vitest";
import {
  isAutoSecretBackend,
  isLocalOnlyVaultKey,
  resolveSecretBackendMode,
  vaultwardenConfigured,
} from "./secret-backend.mjs";

describe("secret-backend", () => {
  it("resolveSecretBackendMode defaults to local without vaultwarden env", () => {
    expect(resolveSecretBackendMode({})).toBe("local");
    expect(isAutoSecretBackend({})).toBe(true);
  });

  it("resolveSecretBackendMode uses vaultwarden when url and email set", () => {
    const env = {
      HDC_VAULTWARDEN_URL: "https://vault.test",
      HDC_VAULTWARDEN_EMAIL: "a@test",
    };
    expect(resolveSecretBackendMode(env)).toBe("vaultwarden");
    expect(vaultwardenConfigured(env)).toBe(true);
  });

  it("isLocalOnlyVaultKey identifies bootstrap keys", () => {
    expect(isLocalOnlyVaultKey("HDC_VAULTWARDEN_ADMIN_TOKEN")).toBe(true);
    expect(isLocalOnlyVaultKey("HDC_PROXMOX_API_TOKEN")).toBe(false);
  });
});
