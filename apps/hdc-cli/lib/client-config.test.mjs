import { describe, expect, it } from "vitest";
import {
  hostsForPlatform,
  normalizeMac,
  resolveHostMac,
  resolveWinrmPasswordVaultKey,
  resolveWinrmUser,
  vaultKeyForWinrmPassword,
  WINRM_USER_PASSWORD_VAULT_KEY,
  wolDefaultsFromConfig,
} from "../../../clumps/clients/lib/client-config.mjs";

describe("client-config", () => {
  it("normalizeMac accepts common formats", () => {
    expect(normalizeMac("aa:bb:cc:dd:ee:ff")).toBe("aa:bb:cc:dd:ee:ff");
    expect(normalizeMac("AA-BB-CC-DD-EE-FF")).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("hostsForPlatform filters os and host-id", () => {
    const cfg = {
      hosts: [
        { id: "pc-a", os: "windows", enabled: true },
        { id: "ws-b", os: "ubuntu", enabled: true },
        { id: "off", os: "ubuntu", enabled: false },
      ],
    };
    expect(hostsForPlatform(cfg, "ubuntu").map((h) => h.id)).toEqual(["ws-b"]);
    expect(hostsForPlatform(cfg, "ubuntu", "ws-b").map((h) => h.id)).toEqual(["ws-b"]);
  });

  it("wolDefaultsFromConfig supplies defaults", () => {
    const d = wolDefaultsFromConfig({ wol: { broadcast: "192.0.2.255", wait_seconds: 60 } });
    expect(d.broadcast).toBe("192.0.2.255");
    expect(d.waitSeconds).toBe(60);
    expect(d.enabled).toBe(true);
  });

  it("vaultKeyForWinrmPassword uses suffix", () => {
    expect(vaultKeyForWinrmPassword("pc-example")).toBe("HDC_WINRM_PASSWORD_PC_EXAMPLE");
  });

  it("resolveWinrmPasswordVaultKey defaults to shared key", () => {
    expect(resolveWinrmPasswordVaultKey({})).toBe(WINRM_USER_PASSWORD_VAULT_KEY);
    expect(resolveWinrmPasswordVaultKey({ winrm_password_vault_suffix: "LAN_1" })).toBe(
      "HDC_WINRM_PASSWORD_LAN_1",
    );
  });

  it("resolveWinrmUser prefers auth.winrm_user over env", () => {
    expect(
      resolveWinrmUser({ winrm_user: ".\\local-admin" }, { HDC_WINRM_USER: "MicrosoftAccount\\a@b.com" }),
    ).toBe(".\\local-admin");
    expect(resolveWinrmUser({}, { HDC_WINRM_USER: "MicrosoftAccount\\a@b.com" })).toBe(
      "MicrosoftAccount\\a@b.com",
    );
    expect(resolveWinrmUser({ winrm_user_env: "HDC_WINRM_USER_LAN_4" }, { HDC_WINRM_USER_LAN_4: ".\\other" })).toBe(
      ".\\other",
    );
    expect(resolveWinrmUser({}, {})).toBeNull();
  });

  it("resolveHostMac prefers wol.mac", () => {
    const mac = resolveHostMac(
      { wol: { mac: "aa:bb:cc:dd:ee:01" }, access: { nodes: [{ mac: "aa:bb:cc:dd:ee:02" }] } },
      "/tmp",
    );
    expect(mac).toBe("aa:bb:cc:dd:ee:01");
  });
});
