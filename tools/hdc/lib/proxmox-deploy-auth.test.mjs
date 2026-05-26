import { describe, expect, it, vi } from "vitest";
import {
  proxmoxApiTokenResetMessage,
  resolveProxmoxApiAuthorization,
  tryVerifyProxmoxToken,
  vaultTokenKeyForHost,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";

describe("proxmox deploy auth", () => {
  it("proxmoxApiTokenResetMessage includes host id and vault keys", () => {
    const msg = proxmoxApiTokenResetMessage("hypervisor-b", [
      "HDC_PROXMOX_API_TOKEN_HYPERVISOR_B",
      "HDC_PROXMOX_API_TOKEN",
    ]);
    expect(msg).toContain("hypervisor-b");
    expect(msg).toContain("HDC_PROXMOX_API_TOKEN_HYPERVISOR_B");
    expect(msg).toContain("secrets set HDC_PROXMOX_API_TOKEN_HYPERVISOR_B");
    expect(msg).toContain("run infrastructure proxmox maintain");
    expect(msg).toContain("secrets delete");
  });

  it("vaultTokenKeyForHost uppercases and hyphenates host id", () => {
    expect(vaultTokenKeyForHost("hypervisor-b")).toBe("HDC_PROXMOX_API_TOKEN_HYPERVISOR_B");
  });

  it("tryVerifyProxmoxToken returns ok when verifyFn succeeds", async () => {
    const verifyFn = vi.fn(async () => ({ major: 8, release: "8.4.0" }));
    const result = await tryVerifyProxmoxToken({
      apiBase: "https://192.0.2.12:8006",
      token: "root@pam!hdc=secret",
      rejectUnauthorized: true,
      verifyFn,
    });
    expect(result.ok).toBe(true);
    expect(result.authorization).toBe("PVEAPIToken=root@pam!hdc=secret");
    expect(result.error).toBeNull();
    expect(verifyFn).toHaveBeenCalledOnce();
  });

  it("tryVerifyProxmoxToken returns error when verifyFn throws", async () => {
    const verifyFn = vi.fn(async () => {
      throw new Error("401 Unauthorized");
    });
    const result = await tryVerifyProxmoxToken({
      apiBase: "https://192.0.2.12:8006",
      token: "root@pam!hdc=bad",
      rejectUnauthorized: true,
      verifyFn,
    });
    expect(result.ok).toBe(false);
    expect(result.authorization).toBeNull();
    expect(result.error).toContain("401");
  });

  it("resolveProxmoxApiAuthorization records rejected vault keys when verify fails", async () => {
    const verifyFn = vi.fn(async () => {
      throw new Error("stale token");
    });
    const perKey = vaultTokenKeyForHost("hypervisor-b");
    const vault = {
      readSecrets: vi.fn(async () => ({
        [perKey]: "root@pam!hdc-old=wrong",
      })),
      setSecret: vi.fn(),
    };
    const warns = [];
    const result = await resolveProxmoxApiAuthorization({
      host: {
        id: "hypervisor-b",
        pveNode: "hypervisor-b",
        apiBase: "https://192.0.2.12:8006",
        webUi: "https://192.0.2.12:8006",
        ip: "192.0.2.12",
        ssh: {},
      },
      vault,
      rejectUnauthorized: true,
      verifyPaths: [],
      verifyFn,
      warn: (line) => warns.push(line),
      prompt: false,
    });

    expect(result.authorization).toBeNull();
    expect(result.rejectedVaultKeys).toEqual([perKey]);
    expect(warns.some((w) => w.includes(perKey) && w.includes("stale"))).toBe(true);
  });

  it("resolveProxmoxApiAuthorization uses per-host vault token when verify succeeds", async () => {
    const perKey = vaultTokenKeyForHost("hypervisor-b");
    const verifyFn = vi.fn(async () => ({ major: 8, release: "8.4.0" }));
    const vault = {
      readSecrets: vi.fn(async () => ({
        [perKey]: "root@pam!hdc=good",
      })),
      setSecret: vi.fn(),
    };
    const result = await resolveProxmoxApiAuthorization({
      host: {
        id: "hypervisor-b",
        pveNode: "hypervisor-b",
        apiBase: "https://192.0.2.12:8006",
        webUi: "https://192.0.2.12:8006",
        ip: "192.0.2.12",
        ssh: {},
      },
      vault,
      rejectUnauthorized: true,
      verifyFn,
      prompt: false,
    });

    expect(result.authorization).toBe("PVEAPIToken=root@pam!hdc=good");
    expect(result.rejectedVaultKeys).toEqual([]);
  });
});
