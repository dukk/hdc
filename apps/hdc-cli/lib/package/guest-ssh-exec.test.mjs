import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  createGuestSshExec,
  wrapRemoteShellForSshUser,
} from "./guest-ssh-exec.mjs";
import { DEFAULT_GUEST_SSH_USER } from "./guest-ssh-resolve.mjs";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawnSync: vi.fn() };
});

describe("guest-ssh-exec", () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wrapRemoteShellForSshUser passes through for root", () => {
    expect(wrapRemoteShellForSshUser("echo hi", "root")).toBe("echo hi");
  });

  it("wrapRemoteShellForSshUser wraps non-root with sudo", () => {
    const wrapped = wrapRemoteShellForSshUser("echo hi", "hdc");
    expect(wrapped).toContain("sudo -n bash -lc");
    expect(wrapped).toContain("echo hi");
  });

  it("createGuestSshExec defaults to hdc without fallback probe", () => {
    const exec = createGuestSshExec({ host: "192.0.2.2", useFallback: false });
    expect(exec.effectiveUser).toBe(DEFAULT_GUEST_SSH_USER);
    expect(exec.label).toBe(`ssh hdc@192.0.2.2`);
  });

  it("createGuestSshExec falls back to root when hdc probe fails", () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 255, stdout: "", stderr: "fail" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const logs = [];
    const exec = createGuestSshExec({
      host: "192.0.2.2",
      log: (line) => logs.push(line),
    });
    expect(exec.effectiveUser).toBe("root");
    expect(exec.fallback_used).toBe(true);
    expect(logs.some((l) => l.includes("fallback"))).toBe(true);
  });

  it("createGuestSshExec respects configured user", () => {
    const exec = createGuestSshExec({
      host: "192.0.2.2",
      configuredUser: "deploy",
      useFallback: false,
    });
    expect(exec.effectiveUser).toBe("deploy");
  });
});
