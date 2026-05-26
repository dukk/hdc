import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ADMIN_USER_ENV,
  ADMIN_USER_PASSWORD_VAULT_KEY,
  adminUserSkippedByFlags,
  ensureAdminUser,
  resetAdminPasswordCache,
  resolveAdminPassword,
  resolveAdminUsername,
} from "./admin-user-ensure.mjs";

describe("admin-user-ensure", () => {
  beforeEach(() => {
    resetAdminPasswordCache();
  });

  it("exports env and vault key constants", () => {
    expect(ADMIN_USER_ENV).toBe("HDC_ADMIN_USER");
    expect(ADMIN_USER_PASSWORD_VAULT_KEY).toBe("HDC_ADMIN_USER_PASSWORD");
  });

  it("resolveAdminUsername reads HDC_ADMIN_USER", () => {
    expect(resolveAdminUsername({ HDC_ADMIN_USER: "testadmin" })).toBe("testadmin");
    expect(() => resolveAdminUsername({})).toThrow(/HDC_ADMIN_USER/);
  });

  it("adminUserSkippedByFlags", () => {
    expect(adminUserSkippedByFlags({ "skip-admin-user": "1" })).toBe(true);
    expect(adminUserSkippedByFlags({ skip_admin_user: "1" })).toBe(true);
    expect(adminUserSkippedByFlags({})).toBe(false);
  });

  it("resolveAdminPassword caches vault getSecret", async () => {
    const getSecret = vi.fn().mockResolvedValue("secret1");
    const vault = {
      unlock: vi.fn().mockResolvedValue(undefined),
      getSecret,
    };
    const a = await resolveAdminPassword(vault);
    const b = await resolveAdminPassword(vault);
    expect(a).toBe("secret1");
    expect(b).toBe("secret1");
    expect(getSecret).toHaveBeenCalledTimes(1);
    expect(getSecret).toHaveBeenCalledWith(ADMIN_USER_PASSWORD_VAULT_KEY, expect.any(Object));
  });

  it("ensureAdminUser runs remote script with fixture username", async () => {
    const run = vi.fn().mockReturnValue({ status: 0, stdout: "", stderr: "" });
    const log = { info: vi.fn(), warn: vi.fn() };
    const vault = {
      unlock: vi.fn().mockResolvedValue(undefined),
      getSecret: vi.fn().mockResolvedValue("pw"),
    };
    const result = await ensureAdminUser({
      exec: { label: "test exec", run },
      log,
      vaultAccess: vault,
      env: { HDC_ADMIN_USER: "testadmin" },
    });
    expect(result.ok).toBe(true);
    expect(result.username).toBe("testadmin");
    expect(run).toHaveBeenCalledOnce();
    const cmd = run.mock.calls[0][0];
    expect(cmd).toContain("testadmin");
    expect(cmd).toContain("chpasswd");
  });

  it("ensureAdminUser skips when flagged", async () => {
    const run = vi.fn();
    const result = await ensureAdminUser({
      exec: { label: "x", run },
      log: { info: vi.fn() },
      flags: { "skip-admin-user": "1" },
      env: { HDC_ADMIN_USER: "testadmin" },
    });
    expect(result.skipped).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});
