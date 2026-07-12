import { describe, expect, it } from "vitest";

import {
  vaultKeyForSynologySshPassword,
  wrapSynologySudoCommand,
  synologySshUserFromEnv,
} from "../../../clumps/infrastructure/synology-nas/lib/synology-ssh.mjs";

describe("vaultKeyForSynologySshPassword", () => {
  it("maps nas-a to NAS_1 suffix", () => {
    expect(vaultKeyForSynologySshPassword("nas-a")).toBe("HDC_SYNOLOGY_SSH_PASSWORD_NAS_A");
    expect(vaultKeyForSynologySshPassword("nas-b")).toBe("HDC_SYNOLOGY_SSH_PASSWORD_NAS_B");
  });
});

describe("synologySshUserFromEnv", () => {
  it("prefers configured user_env", () => {
    expect(
      synologySshUserFromEnv({ HDC_SYNOLOGY_SSH_USER: "admin" }, "HDC_SYNOLOGY_SSH_USER", "root"),
    ).toBe("admin");
  });
});

describe("wrapSynologySudoCommand", () => {
  it("passes through for root", () => {
    expect(wrapSynologySudoCommand("root", "synoupgrade --check", null)).toBe("synoupgrade --check");
  });

  it("wraps admin with sudo -S when password set", () => {
    const cmd = wrapSynologySudoCommand("admin", "synopkg upgradeall", "secret");
    expect(cmd).toContain("sudo -S");
    expect(cmd).toContain("synopkg upgradeall");
  });
});
