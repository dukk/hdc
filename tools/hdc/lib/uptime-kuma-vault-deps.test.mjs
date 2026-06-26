import { describe, expect, it, vi } from "vitest";

import {
  UPTIME_KUMA_PASSWORD_VAULT_KEY,
  UPTIME_KUMA_USERNAME_ENV,
  resolveUptimeKumaCredentials,
  resolveUptimeKumaPassword,
} from "../../../packages/services/uptime-kuma/lib/vault-deps.mjs";

describe("uptime-kuma vault-deps", () => {
  it("resolveUptimeKumaPassword uses getSecret with optional and returns trimmed value", async () => {
    const unlock = vi.fn().mockResolvedValue(undefined);
    const getSecret = vi.fn().mockResolvedValue("  secret-pass  ");
    const vault = { unlock, getSecret };

    const password = await resolveUptimeKumaPassword(vault);

    expect(unlock).toHaveBeenCalledOnce();
    expect(getSecret).toHaveBeenCalledWith(UPTIME_KUMA_PASSWORD_VAULT_KEY, { optional: true });
    expect(password).toBe("secret-pass");
  });

  it("resolveUptimeKumaPassword throws when getSecret returns empty", async () => {
    const vault = {
      unlock: vi.fn().mockResolvedValue(undefined),
      getSecret: vi.fn().mockResolvedValue(""),
    };

    await expect(resolveUptimeKumaPassword(vault)).rejects.toThrow(UPTIME_KUMA_PASSWORD_VAULT_KEY);
    await expect(resolveUptimeKumaPassword(vault)).rejects.toThrow("secrets set");
  });

  it("resolveUptimeKumaCredentials resolves username from env and password from vault", async () => {
    const prev = process.env[UPTIME_KUMA_USERNAME_ENV];
    process.env[UPTIME_KUMA_USERNAME_ENV] = "admin";

    try {
      const vault = {
        unlock: vi.fn().mockResolvedValue(undefined),
        getSecret: vi.fn().mockResolvedValue("pw"),
      };

      const creds = await resolveUptimeKumaCredentials(vault);

      expect(creds.username).toBe("admin");
      expect(creds.password).toBe("pw");
      expect(creds.usernameEnv).toBe(UPTIME_KUMA_USERNAME_ENV);
      expect(creds.passwordVaultKey).toBe(UPTIME_KUMA_PASSWORD_VAULT_KEY);
    } finally {
      if (prev === undefined) delete process.env[UPTIME_KUMA_USERNAME_ENV];
      else process.env[UPTIME_KUMA_USERNAME_ENV] = prev;
    }
  });
});
