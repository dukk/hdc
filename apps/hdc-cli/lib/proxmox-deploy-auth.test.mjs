import { describe, expect, it } from "vitest";
import {
  parsePveApiTokenValue,
  proxmoxMaintainVerifyPaths,
  pveTokenAclId,
  vaultTokenKeyForHost,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";

describe("proxmox deploy auth", () => {
  it("vaultTokenKeyForHost uppercases and hyphenates host id", () => {
    expect(vaultTokenKeyForHost("hypervisor-b")).toBe("HDC_PROXMOX_API_TOKEN_HYPERVISOR_B");
  });

  it("parsePveApiTokenValue splits userid and token id", () => {
    expect(parsePveApiTokenValue("root@pam!hdc-example=secret")).toEqual({
      userid: "root@pam",
      tokenid: "hdc-example",
    });
  });

  it("pveTokenAclId builds ACL token id", () => {
    expect(pveTokenAclId({ userid: "root@pam", tokenid: "hdc-example" })).toBe(
      "root@pam!hdc-example",
    );
  });

  it("proxmoxMaintainVerifyPaths includes cluster resources and storage", () => {
    const paths = proxmoxMaintainVerifyPaths("hypervisor-d", "local");
    expect(paths).toContain("/cluster/resources?type=vm");
    expect(paths).toContain("/nodes/hypervisor-d/storage/local/content?content=vztmpl");
    expect(paths).toContain("/storage");
  });
});
