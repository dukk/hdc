import { describe, expect, it } from "vitest";
import {
  LINUX_USERNAME_RE,
  remoteBootstrapHdcBash,
  remoteEnsureHdcAutomationUserBash,
  remoteEnsureLocalAdminUserBash,
  remoteInstallAuthorizedKeysForUserBash,
  validateLinuxUsername,
} from "./linux-local-admin-user.mjs";

describe("linux-local-admin-user", () => {
  it("LINUX_USERNAME_RE accepts valid names", () => {
    expect(LINUX_USERNAME_RE.test("testadmin")).toBe(true);
    expect(LINUX_USERNAME_RE.test("hdc")).toBe(true);
    expect(LINUX_USERNAME_RE.test("_a1")).toBe(true);
    expect(LINUX_USERNAME_RE.test("Bad")).toBe(false);
    expect(LINUX_USERNAME_RE.test("")).toBe(false);
  });

  it("validateLinuxUsername trims and rejects invalid", () => {
    expect(validateLinuxUsername("  testadmin  ")).toBe("testadmin");
    expect(() => validateLinuxUsername("")).toThrow(/required/);
    expect(() => validateLinuxUsername("root!")).toThrow(/Invalid Linux username/);
  });

  it("remoteEnsureLocalAdminUserBash embeds username and base64 payload", () => {
    const s = remoteEnsureLocalAdminUserBash("testadmin", "YWJj");
    expect(s).toContain("base64 -d");
    expect(s).toContain("YWJj");
    expect(s).toContain("useradd -m -s /bin/bash testadmin");
    expect(s).toContain("chpasswd");
    expect(s).toContain("usermod -aG sudo testadmin");
  });

  it("remoteBootstrapHdcBash uses hdc", () => {
    const s = remoteBootstrapHdcBash("YWJj");
    expect(s).toContain("useradd -m -s /bin/bash hdc");
    expect(s).toContain("hdc-automation");
  });

  it("remoteEnsureHdcAutomationUserBash installs passwordless sudo drop-in", () => {
    const s = remoteEnsureHdcAutomationUserBash("YWJj");
    expect(s).toContain("useradd -m -s /bin/bash hdc");
    expect(s).toContain("/etc/sudoers.d/hdc-automation");
    expect(s).toContain("NOPASSWD:ALL");
  });

  it("remoteInstallAuthorizedKeysForUserBash targets user home and is idempotent", () => {
    const keyB64 = Buffer.from("ssh-ed25519 AAAA test", "utf8").toString("base64");
    const s = remoteInstallAuthorizedKeysForUserBash("testadmin", [keyB64]);
    expect(s).toContain("getent passwd");
    expect(s).toContain("HOME_DIR/.ssh/authorized_keys");
    expect(s).toContain("chown");
    expect(s).toContain("grep -qxF");
    expect(s).toContain(keyB64);
  });

  it("remoteInstallAuthorizedKeysForUserBash rejects empty key list", () => {
    expect(() => remoteInstallAuthorizedKeysForUserBash("testadmin", [])).toThrow(
      /non-empty array/,
    );
  });
});
