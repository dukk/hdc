import { describe, expect, it } from "vitest";
import { sshBashLcRemoteArgv } from "./ssh-host-access.mjs";
import {
  apiTokenMaintainEnabledFromConfig,
  apiTokenPrivilegesFromConfig,
  apiTokenUseridFromConfig,
  hdcProxmoxTokenIdFromHostname,
  parsePveumTokenSecret,
  pveumCreateOrRegenerateTokenScript,
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
  it("hdcProxmoxTokenIdFromHostname builds hdc-prefixed slug", () => {
    expect(hdcProxmoxTokenIdFromHostname("DUKK-LAP")).toBe("hdc-dukk-lap");
    expect(hdcProxmoxTokenIdFromHostname("  My_Host  ")).toBe("hdc-my_host");
  });

  it("apiTokenUseridFromConfig defaults to root@pam", () => {
    expect(apiTokenUseridFromConfig({})).toBe("root@pam");
    expect(apiTokenUseridFromConfig({ provision: { api_token: { userid: "ops@pve" } } })).toBe("ops@pve");
  });

  it("pveumCreateOrRegenerateTokenScript branches on token list", () => {
    const script = pveumCreateOrRegenerateTokenScript("root@pam", "hdc-dukk-lap");
    expect(script).toContain("pveum user token list 'root@pam'");
    expect(script).toContain("pveum user token modify 'root@pam' 'hdc-dukk-lap' --regenerate 1 --privsep 1");
    expect(script).toContain("pveum user token add 'root@pam' 'hdc-dukk-lap' --privsep 1");
  });

  it("parsePveumTokenSecret reads JSON value field", () => {
    const stdout = JSON.stringify({
      data: { value: "abc-def-123", "full-tokenid": "root@pam!hdc-dukk-lap" },
    });
    expect(parsePveumTokenSecret(stdout, "root@pam", "hdc-dukk-lap")).toBe(
      "root@pam!hdc-dukk-lap=abc-def-123",
    );
  });

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
    const paths = proxmoxMaintainVerifyPaths("hypervisor-d", "local");
    expect(paths).toContain("/cluster/resources?type=vm");
    expect(paths).toContain("/nodes/hypervisor-d/storage/local/content?content=vztmpl");
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
    expect(script).toContain("fi\npveum acl modify");
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
