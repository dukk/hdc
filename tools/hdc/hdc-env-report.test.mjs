import { describe, expect, it } from "vitest";
import {
  collectHdcEnvRows,
  formatHdcEnvValueForDisplay,
  hdcEnvKeyLooksSensitive,
} from "./lib/hdc-env-report.mjs";

describe("hdc-env-report", () => {
  it("flags sensitive keys by name", () => {
    expect(hdcEnvKeyLooksSensitive("HDC_VAULT_PASSPHRASE")).toBe(true);
    expect(hdcEnvKeyLooksSensitive("HDC_PROXMOX_API_TOKEN")).toBe(true);
    expect(hdcEnvKeyLooksSensitive("HDC_UNIFI_NETWORK_API_KEY")).toBe(true);
    expect(hdcEnvKeyLooksSensitive("HDC_USER_HDC_PASSWORD_PVE_A")).toBe(true);
    expect(hdcEnvKeyLooksSensitive("HDC_CLI_INVOCATION")).toBe(false);
    expect(hdcEnvKeyLooksSensitive("HDC_SKIP_LOCAL_SYSTEM_INVENTORY")).toBe(false);
    expect(hdcEnvKeyLooksSensitive("HDC_PROXMOX_TLS_INSECURE")).toBe(false);
    expect(hdcEnvKeyLooksSensitive("HDC_TLS_INSECURE")).toBe(false);
    expect(hdcEnvKeyLooksSensitive("HDC_PROXMOX_SSH_USER")).toBe(false);
  });

  it("formats values for display", () => {
    expect(formatHdcEnvValueForDisplay("HDC_X", "")).toBe("(empty)");
    expect(formatHdcEnvValueForDisplay("HDC_X", undefined)).toBe("(undefined)");
    expect(formatHdcEnvValueForDisplay("HDC_A", "hello")).toBe("hello");
    expect(formatHdcEnvValueForDisplay("HDC_A", "a\nb")).toBe("a\\nb");
    expect(formatHdcEnvValueForDisplay("HDC_VAULT_PASSPHRASE", "topsecret")).toBe("(set, 9 chars)");
  });

  it("collectHdcEnvRows sorts and filters HDC_ prefix", () => {
    const rows = collectHdcEnvRows({
      ZOther: "z",
      HDC_B: "2",
      HDC_A: "1",
      NOT_HDC: "x",
    });
    expect(rows.map((r) => r.key)).toEqual(["HDC_A", "HDC_B"]);
    expect(rows[0].display).toBe("1");
  });
});
