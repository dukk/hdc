import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUEST_SSH_USER,
  FALLBACK_BOOTSTRAP_SSH_USER,
  resolveGuestSshUser,
  systemIdFromDeployment,
} from "./guest-ssh-resolve.mjs";

describe("guest-ssh-resolve", () => {
  it("resolveGuestSshUser prefers configure.ssh.user", () => {
    expect(resolveGuestSshUser("root")).toBe("root");
    expect(resolveGuestSshUser("  hdc  ")).toBe("hdc");
  });

  it("resolveGuestSshUser reads HDC_GUEST_SSH_USER", () => {
    expect(resolveGuestSshUser(undefined, { HDC_GUEST_SSH_USER: "automation" })).toBe(
      "automation",
    );
  });

  it("resolveGuestSshUser defaults to hdc", () => {
    expect(resolveGuestSshUser(undefined, {})).toBe(DEFAULT_GUEST_SSH_USER);
    expect(DEFAULT_GUEST_SSH_USER).toBe("hdc");
    expect(FALLBACK_BOOTSTRAP_SSH_USER).toBe("root");
  });

  it("systemIdFromDeployment reads system_id or systemId", () => {
    expect(systemIdFromDeployment({ system_id: "vm-bind-a" })).toBe("vm-bind-a");
    expect(systemIdFromDeployment({ systemId: "vm-bind-b" })).toBe("vm-bind-b");
    expect(systemIdFromDeployment({})).toBeNull();
  });
});
