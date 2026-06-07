import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  HDC_AUTOMATION_USERNAME,
  hdcPasswordVaultKeyForSystem,
  hdcUserSkippedByFlags,
  hdcUserSshKeysSkippedByFlags,
  ensureHdcUser,
  resetHdcPasswordCache,
  resolveHdcPasswordForSystem,
} from "./hdc-user-ensure.mjs";

describe("hdc-user-ensure", () => {
  beforeEach(() => {
    resetHdcPasswordCache();
  });

  it("hdcPasswordVaultKeyForSystem uses inventory id suffix", () => {
    expect(hdcPasswordVaultKeyForSystem("vm-bind-a")).toBe("HDC_USER_HDC_PASSWORD_VM_BIND_A");
  });

  it("hdcUserSkippedByFlags", () => {
    expect(hdcUserSkippedByFlags({ "skip-hdc-user": "1" })).toBe(true);
    expect(hdcUserSkippedByFlags({ skip_hdc_user: "1" })).toBe(true);
    expect(hdcUserSkippedByFlags({})).toBe(false);
  });

  it("hdcUserSshKeysSkippedByFlags", () => {
    expect(hdcUserSshKeysSkippedByFlags({ "skip-hdc-ssh-keys": "1" })).toBe(true);
    expect(hdcUserSshKeysSkippedByFlags({})).toBe(false);
  });

  it("resolveHdcPasswordForSystem auto-generates when missing", async () => {
    const setSecret = vi.fn().mockResolvedValue(undefined);
    const vault = {
      unlock: vi.fn().mockResolvedValue(undefined),
      getSecret: vi.fn().mockRejectedValue(new Error("missing")),
      setSecret,
    };
    const pw = await resolveHdcPasswordForSystem("vm-bind-a", vault, { autoGenerate: true });
    expect(pw.length).toBeGreaterThanOrEqual(16);
    expect(setSecret).toHaveBeenCalledWith("HDC_USER_HDC_PASSWORD_VM_BIND_A", pw);
  });

  it("resolveHdcPasswordForSystem reuses existing vault secret", async () => {
    const setSecret = vi.fn();
    const vault = {
      unlock: vi.fn().mockResolvedValue(undefined),
      getSecret: vi.fn().mockResolvedValue("existing-pw"),
      setSecret,
    };
    const pw = await resolveHdcPasswordForSystem("vm-bind-a", vault, { autoGenerate: true });
    expect(pw).toBe("existing-pw");
    expect(setSecret).not.toHaveBeenCalled();
  });

  it("ensureHdcUser requires system_id", async () => {
    const run = vi.fn();
    const result = await ensureHdcUser({
      exec: { label: "test", run },
      log: { info: vi.fn(), warn: vi.fn() },
      vaultAccess: { unlock: vi.fn(), getSecret: vi.fn(), setSecret: vi.fn() },
      deployment: {},
    });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("ensureHdcUser skips when flagged", async () => {
    const run = vi.fn();
    const result = await ensureHdcUser({
      exec: { label: "test", run },
      log: { info: vi.fn() },
      flags: { "skip-hdc-user": "1" },
      vaultAccess: { unlock: vi.fn(), getSecret: vi.fn(), setSecret: vi.fn() },
      systemId: "vm-bind-a",
    });
    expect(result.skipped).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("ensureHdcUser runs remote script for hdc user", async () => {
    const run = vi.fn().mockReturnValue({ status: 0, stdout: "", stderr: "" });
    const vault = {
      unlock: vi.fn().mockResolvedValue(undefined),
      getSecret: vi.fn().mockResolvedValue("pw"),
      setSecret: vi.fn(),
    };
    const result = await ensureHdcUser({
      exec: { label: "test exec", run },
      log: { info: vi.fn(), warn: vi.fn() },
      vaultAccess: vault,
      systemId: "vm-bind-a",
      flags: { "skip-hdc-ssh-keys": "1" },
    });
    expect(result.ok).toBe(true);
    expect(result.username).toBe(HDC_AUTOMATION_USERNAME);
    expect(result.vault_key).toBe("HDC_USER_HDC_PASSWORD_VM_BIND_A");
    expect(run).toHaveBeenCalledOnce();
    const cmd = run.mock.calls[0][0];
    expect(cmd).toContain("hdc-automation");
    expect(cmd).toContain("hdc");
  });
});
