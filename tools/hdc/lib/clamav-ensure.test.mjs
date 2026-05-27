import { describe, expect, it, vi } from "vitest";
import {
  aptLockProbeCommand,
  waitForAptLock,
} from "../../../packages/lib/apt-lock-wait.mjs";
import {
  clamavAptInstallCommand,
  clamavInstalledCheckCommand,
  clamavSkippedByFlags,
  ensureClamav,
} from "../../../packages/lib/clamav-ensure.mjs";
import { listSshTargetsFromPackageConfig } from "../../../packages/lib/maintain-clamav-only.mjs";

describe("clamav-ensure", () => {
  it("exposes dpkg check for clamav", () => {
    expect(clamavInstalledCheckCommand()).toContain("dpkg -s clamav");
  });

  it("apt install includes clamav packages", () => {
    const cmd = clamavAptInstallCommand();
    expect(cmd).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(cmd).toContain("clamav");
    expect(cmd).toContain("clamav-freshclam");
  });

  it("honours --skip-clamav and skip_clamav flags", () => {
    expect(clamavSkippedByFlags({ "skip-clamav": "1" })).toBe(true);
    expect(clamavSkippedByFlags({ skip_clamav: "1" })).toBe(true);
    expect(clamavSkippedByFlags({})).toBe(false);
  });
});

describe("apt-lock-wait", () => {
  it("probe checks dpkg and apt list locks", () => {
    const cmd = aptLockProbeCommand();
    expect(cmd).toContain("/var/lib/dpkg/lock-frontend");
    expect(cmd).toContain("/var/lib/apt/lists/lock");
    expect(cmd).toContain("fuser");
  });

  it("waitForAptLock resolves when probe succeeds immediately", async () => {
    const exec = {
      label: "ssh test@host",
      run: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
    };
    const log = { info: vi.fn() };
    const result = await waitForAptLock(exec, log, { timeoutMs: 1000, pollMs: 10 });
    expect(result.ok).toBe(true);
    expect(exec.run).toHaveBeenCalledWith(aptLockProbeCommand(), { capture: true });
  });

  it("waitForAptLock polls until lock releases", async () => {
    let calls = 0;
    const exec = {
      label: "ssh test@host",
      run: vi.fn(() => {
        calls += 1;
        return { status: calls < 3 ? 1 : 0, stdout: "", stderr: "" };
      }),
    };
    const log = { info: vi.fn() };
    const result = await waitForAptLock(exec, log, { timeoutMs: 5000, pollMs: 10 });
    expect(result.ok).toBe(true);
    expect(exec.run.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("waitForAptLock times out when lock never releases", async () => {
    const exec = {
      label: "ssh test@host",
      run: vi.fn(() => ({ status: 1, stdout: "", stderr: "" })),
    };
    const log = { info: vi.fn(), warn: vi.fn() };
    const result = await waitForAptLock(exec, log, { timeoutMs: 30, pollMs: 10 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("apt lock timeout");
  });

  it("ensureClamav waits for apt lock before install", async () => {
    const probe = aptLockProbeCommand();
    const install = clamavAptInstallCommand();
    const commands = [];
    const exec = {
      label: "ssh test@host",
      run: vi.fn((cmd) => {
        commands.push(cmd);
        if (cmd === probe) return { status: 0, stdout: "", stderr: "" };
        if (cmd.includes("dpkg -s clamav")) return { status: 1, stdout: "", stderr: "" };
        if (cmd === install || cmd.includes("clamav-freshclam")) {
          return { status: 0, stdout: "", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      }),
    };
    const log = { info: vi.fn() };
    const result = await ensureClamav({ exec, log });
    expect(result.ok).toBe(true);
    const probeIdx = commands.findIndex((c) => c === probe);
    const installIdx = commands.findIndex((c) => c === install);
    expect(probeIdx).toBeGreaterThanOrEqual(0);
    expect(installIdx).toBeGreaterThan(probeIdx);
  });
});

describe("maintain-clamav-only listSshTargetsFromPackageConfig", () => {
  it("collects SSH targets from deployments", () => {
    const targets = listSshTargetsFromPackageConfig({
      deployments: [
        {
          system_id: "vm-bind-a",
          configure: { ssh: { user: "root", host: "192.0.2.10" } },
        },
        {
          system_id: "vm-bind-b",
          configure: { ssh: { user: "root", host: "192.0.2.11" } },
        },
      ],
    });
    expect(targets).toHaveLength(2);
    expect(targets[0].host).toBe("192.0.2.10");
  });

  it("dedupes identical SSH endpoints", () => {
    const targets = listSshTargetsFromPackageConfig({
      deployments: [
        { system_id: "a", configure: { ssh: { host: "192.0.2.1" } } },
        { system_id: "b", configure: { ssh: { host: "192.0.2.1" } } },
      ],
    });
    expect(targets).toHaveLength(1);
  });
});
