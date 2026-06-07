import { describe, expect, it, vi } from "vitest";
import {
  ROOT_SSH_DROPIN,
  ensureRootDisabled,
  remoteDisableRootLoginBash,
  rootDisableSkippedByFlags,
} from "./root-login-disable.mjs";

describe("root-login-disable", () => {
  it("rootDisableSkippedByFlags", () => {
    expect(rootDisableSkippedByFlags({ "skip-disable-root": "1" })).toBe(true);
    expect(rootDisableSkippedByFlags({ skip_disable_root: "1" })).toBe(true);
    expect(rootDisableSkippedByFlags({})).toBe(false);
  });

  it("remoteDisableRootLoginBash locks root and sets PermitRootLogin no", () => {
    const script = remoteDisableRootLoginBash("dukk");
    expect(script).toContain(`id -u hdc`);
    expect(script).toContain(`id -u dukk`);
    expect(script).toContain("PermitRootLogin no");
    expect(script).toContain(ROOT_SSH_DROPIN);
    expect(script).toContain("passwd -l root");
  });

  it("ensureRootDisabled skips when hdc or admin skipped", () => {
    const run = vi.fn();
    const result = ensureRootDisabled({
      exec: { label: "test", run },
      log: { info: vi.fn() },
      hdcUser: { ok: true, skipped: true },
      adminUser: { ok: true, skipped: false },
    });
    expect(result.skipped).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("ensureRootDisabled skips when flagged", () => {
    const run = vi.fn();
    const result = ensureRootDisabled({
      exec: { label: "test", run },
      log: { info: vi.fn() },
      flags: { "skip-disable-root": "1" },
      hdcUser: { ok: true, skipped: false },
      adminUser: { ok: true, skipped: false },
    });
    expect(result.skipped).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("ensureRootDisabled runs when both users ok", () => {
    const run = vi.fn().mockReturnValue({ status: 0, stdout: "", stderr: "" });
    const result = ensureRootDisabled({
      exec: { label: "test exec", run },
      log: { info: vi.fn() },
      env: { HDC_ADMIN_USER: "dukk" },
      hdcUser: { ok: true, skipped: false },
      adminUser: { ok: true, skipped: false },
    });
    expect(result.ok).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0]).toContain("PermitRootLogin no");
  });

  it("ensureRootDisabled fails when hdc user not ensured", () => {
    const run = vi.fn();
    const result = ensureRootDisabled({
      exec: { label: "test", run },
      log: { info: vi.fn(), warn: vi.fn() },
      env: { HDC_ADMIN_USER: "dukk" },
      hdcUser: { ok: false, skipped: false },
      adminUser: { ok: true, skipped: false },
    });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
