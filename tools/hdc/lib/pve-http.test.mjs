import { describe, expect, it } from "vitest";
import {
  pveFormBody,
  pveTaskExitIsError,
} from "../../../packages/infrastructure/proxmox/lib/pve-http.mjs";

describe("pveFormBody", () => {
  it("encodeURIComponent preserves + in SSH keys (not URLSearchParams + as space)", () => {
    const key =
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG1vY2t+U3Rlc3RLZXlGb3JFbmNvZGluZyB0ZXN0 test@example.invalid";
    const body = pveFormBody({ sshkeys: key });
    expect(body).toContain("%2B");
    expect(body).not.toMatch(/sshkeys=ssh-ed25519\+/);
    expect(body).toBe(`sshkeys=${encodeURIComponent(key)}`);
  });
});

describe("pveTaskExitIsError", () => {
  it("treats OK as success", () => {
    expect(pveTaskExitIsError("OK")).toBe(false);
  });

  it("treats WARNINGS: N as success", () => {
    expect(pveTaskExitIsError("WARNINGS: 1")).toBe(false);
    expect(pveTaskExitIsError("WARNINGS: 12")).toBe(false);
  });

  it("treats real failures as error", () => {
    expect(pveTaskExitIsError("start failed: QEMU exited with code 1")).toBe(true);
    expect(pveTaskExitIsError("unexpected status")).toBe(true);
  });

  it("treats empty or unknown exit as error", () => {
    expect(pveTaskExitIsError("")).toBe(true);
    expect(pveTaskExitIsError("   ")).toBe(true);
    expect(pveTaskExitIsError("garbage")).toBe(true);
  });

  it("does not treat malformed WARNINGS as success", () => {
    expect(pveTaskExitIsError("WARNINGS:1")).toBe(true);
    expect(pveTaskExitIsError("WARNINGS: x")).toBe(true);
  });
});
