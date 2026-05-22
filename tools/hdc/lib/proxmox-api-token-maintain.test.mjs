import { describe, expect, it } from "vitest";
import { sshBashLcRemoteArgv } from "./ssh-host-access.mjs";
import {
  apiTokenMaintainEnabledFromConfig,
  apiTokenPrivilegesFromConfig,
  pveumEnsureRoleAndAclScript,
  pveumEnsureRoleCommands,
  pveumEnsureTokenAclCommand,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-api-token-maintain.mjs";
import { pveProfileForMajor } from "../../../packages/infrastructure/proxmox/lib/pve-version.mjs";
import {
  parsePveApiTokenValue,
  proxmoxMaintainVerifyPaths,
  pveTokenAclId,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";

describe("proxmox API token maintain", () => {
  it("parsePveApiTokenValue accepts vault and PVEAPIToken forms", () => {
    expect(parsePveApiTokenValue("root@pam!hdc-token=secret")).toEqual({
      userid: "root@pam",
      tokenid: "hdc-token",
    });
    expect(parsePveApiTokenValue("PVEAPIToken=root@pam!hdc=abc")).toEqual({
      userid: "root@pam",
      tokenid: "hdc",
    });
    expect(parsePveApiTokenValue("bad")).toBeNull();
  });

  it("pveTokenAclId formats ACL token id", () => {
    expect(pveTokenAclId({ userid: "root@pam", tokenid: "hdc-token" })).toBe("root@pam!hdc-token");
  });

  it("proxmoxMaintainVerifyPaths includes vztmpl and storage", () => {
    const paths = proxmoxMaintainVerifyPaths("pve-d", "local");
    expect(paths).toContain("/cluster/resources?type=vm");
    expect(paths).toContain("/nodes/pve-d/storage/local/content?content=vztmpl");
    expect(paths).toContain("/storage");
  });

  it("pveum commands set role and token ACL", () => {
    const roleCmd = pveumEnsureRoleCommands("HDCMaintain", ["VM.Audit", "Datastore.Audit"]).join("; ");
    expect(roleCmd).toContain("pveum role modify 'HDCMaintain'");
    expect(roleCmd).toContain("pveum role add 'HDCMaintain'");
    expect(roleCmd).toContain("grep -qxF 'HDCMaintain'");
    expect(roleCmd).toContain("VM.Audit,Datastore.Audit");
    expect(pveumEnsureTokenAclCommand("root@pam!hdc-token", "HDCMaintain")).toContain(
      "pveum acl modify / -token 'root@pam!hdc-token'",
    );
  });

  it("pveum script is one quoted bash -lc remote command for SSH", () => {
    const script = pveumEnsureRoleAndAclScript("HDCMaintain", ["VM.Audit", "Datastore.Audit"], "root@pam!hdc");
    expect(script).toContain("fi; pveum acl modify");
    const argv = sshBashLcRemoteArgv(script);
    expect(argv).toHaveLength(1);
    expect(argv[0].startsWith("bash -lc '")).toBe(true);
    expect(argv[0].endsWith("'")).toBe(true);
    expect(argv[0]).not.toMatch(/^bash -lc if /);
  });

  it("apiTokenMaintainEnabledFromConfig respects enabled flag", () => {
    expect(apiTokenMaintainEnabledFromConfig({ provision: { api_token: { enabled: false } } })).toBe(
      false,
    );
    expect(apiTokenMaintainEnabledFromConfig({})).toBe(true);
  });

  it("apiTokenPrivilegesFromConfig uses profile defaults", () => {
    const privs8 = apiTokenPrivilegesFromConfig({}, pveProfileForMajor(8));
    const privs9 = apiTokenPrivilegesFromConfig({}, pveProfileForMajor(9));
    expect(privs8).toContain("Datastore.Audit");
    expect(privs8).toContain("VM.Audit");
    expect(privs9).toContain("Sys.AccessNetwork");
    expect(privs8).not.toContain("Sys.AccessNetwork");
    expect(privs8).toContain("VM.Monitor");
    expect(privs9).not.toContain("VM.Monitor");
  });
});
