import { describe, expect, it } from "vitest";

import {
  vaultKeyForSynologySshPassword,
  vaultKeysForSynologySshPassword,
  wrapSynologySudoCommand,
  synologySshUserFromEnv,
} from "../../../clumps/infrastructure/synology-nas/lib/synology-ssh.mjs";

describe("vaultKeyForSynologySshPassword", () => {
  it("maps nas-a / nas-b to NAS_A / NAS_B suffixes", () => {
    expect(vaultKeyForSynologySshPassword("nas-a")).toBe("HDC_SYNOLOGY_SSH_PASSWORD_NAS_A");
    expect(vaultKeyForSynologySshPassword("nas-b")).toBe("HDC_SYNOLOGY_SSH_PASSWORD_NAS_B");
  });
});

describe("vaultKeysForSynologySshPassword", () => {
  it("includes legacy NAS_1 / NAS_2 aliases", () => {
    expect(vaultKeysForSynologySshPassword("nas-a")).toEqual([
      "HDC_SYNOLOGY_SSH_PASSWORD_NAS_A",
      "HDC_SYNOLOGY_SSH_PASSWORD_NAS_1",
    ]);
    expect(vaultKeysForSynologySshPassword("nas-b")).toEqual([
      "HDC_SYNOLOGY_SSH_PASSWORD_NAS_B",
      "HDC_SYNOLOGY_SSH_PASSWORD_NAS_2",
    ]);
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
