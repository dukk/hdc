import { describe, expect, it, vi } from "vitest";

import {
  resolveVaultwardenApiKeyCredentials,
  vaultwardenApiKeyFromEnv,
} from "./vault-deps.mjs";

describe("hdc-runner vault-deps", () => {
  it("vaultwardenApiKeyFromEnv returns pair when both vars set", () => {
    expect(
      vaultwardenApiKeyFromEnv({
        HDC_VAULTWARDEN_KEY_CLIENT_ID: "user.test-id",
        HDC_VAULTWARDEN_KEY_CLIENT_SECRET: "secret",
      }),
    ).toEqual({ clientId: "user.test-id", clientSecret: "secret" });
  });

  it("vaultwardenApiKeyFromEnv returns null for partial pair", () => {
    expect(vaultwardenApiKeyFromEnv({ HDC_VAULTWARDEN_KEY_CLIENT_ID: "user.test-id" })).toBeNull();
  });

  it("resolveVaultwardenApiKeyCredentials prefers envMap over vault", async () => {
    const vaultAccess = {
      getSecret: vi.fn(async () => "from-vault"),
    };
    const creds = await resolveVaultwardenApiKeyCredentials(vaultAccess, {
      envMap: {
        HDC_VAULTWARDEN_KEY_CLIENT_ID: "user.from-env",
        HDC_VAULTWARDEN_KEY_CLIENT_SECRET: "env-secret",
      },
    });
    expect(creds).toEqual({ clientId: "user.from-env", clientSecret: "env-secret" });
    expect(vaultAccess.getSecret).not.toHaveBeenCalled();
  });
});
