import { describe, expect, it } from "vitest";
import {
  isAutoSecretBackend,
  isLocalOnlyVaultKey,
  resolveSecretBackendMode,
  vaultwardenApiKeyConfigured,
  vaultwardenAuthMode,
  vaultwardenCollectionIdFromEnv,
  vaultwardenConfigured,
  vaultwardenOrganizationIdFromEnv,
  vaultwardenOrganizationNameFromEnv,
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

  it("resolveSecretBackendMode uses vaultwarden when url and api key pair set", () => {
    const env = {
      HDC_VAULTWARDEN_URL: "https://vault.test",
      HDC_VAULTWARDEN_KEY_CLIENT_ID: "user.test-id",
      HDC_VAULTWARDEN_KEY_CLIENT_SECRET: "test-secret",
    };
    expect(resolveSecretBackendMode(env)).toBe("vaultwarden");
    expect(vaultwardenConfigured(env)).toBe(true);
    expect(vaultwardenApiKeyConfigured(env)).toBe(true);
    expect(vaultwardenAuthMode(env)).toBe("apikey");
  });

  it("vaultwardenAuthMode prefers apikey when both auth methods in env", () => {
    const env = {
      HDC_VAULTWARDEN_URL: "https://vault.test",
      HDC_VAULTWARDEN_EMAIL: "a@test",
      HDC_VAULTWARDEN_KEY_CLIENT_ID: "user.test-id",
      HDC_VAULTWARDEN_KEY_CLIENT_SECRET: "test-secret",
    };
    expect(vaultwardenAuthMode(env)).toBe("apikey");
  });

  it("vaultwardenConfigured false when url only or partial api key", () => {
    expect(vaultwardenConfigured({ HDC_VAULTWARDEN_URL: "https://vault.test" })).toBe(false);
    expect(
      vaultwardenConfigured({
        HDC_VAULTWARDEN_URL: "https://vault.test",
        HDC_VAULTWARDEN_KEY_CLIENT_ID: "user.test-id",
      }),
    ).toBe(false);
  });

  it("isLocalOnlyVaultKey identifies bootstrap keys", () => {
    expect(isLocalOnlyVaultKey("HDC_VAULTWARDEN_ADMIN_TOKEN")).toBe(true);
    expect(isLocalOnlyVaultKey("HDC_VAULTWARDEN_KEY_CLIENT_ID")).toBe(true);
    expect(isLocalOnlyVaultKey("HDC_VAULTWARDEN_KEY_CLIENT_SECRET")).toBe(true);
    expect(isLocalOnlyVaultKey("HDC_PROXMOX_API_TOKEN")).toBe(false);
  });

  it("vaultwarden org/collection env helpers", () => {
    const env = {
      HDC_VAULTWARDEN_ORGANIZATION_ID: "org-uuid",
      HDC_VAULTWARDEN_COLLECTION_ID: "coll-uuid",
      HDC_VAULTWARDEN_ORGANIZATION_NAME: "MyOrg",
    };
    expect(vaultwardenOrganizationIdFromEnv(env)).toBe("org-uuid");
    expect(vaultwardenCollectionIdFromEnv(env)).toBe("coll-uuid");
    expect(vaultwardenOrganizationNameFromEnv(env)).toBe("MyOrg");
    expect(vaultwardenOrganizationNameFromEnv({})).toBe("HDC");
    expect(vaultwardenOrganizationIdFromEnv({})).toBeNull();
  });
});
