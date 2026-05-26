import { describe, expect, it } from "vitest";
import {
  discoverLocalSshMaterial,
  remoteInstallAuthorizedKeysBash,
  vaultKeyForProxmoxSshPassword,
  buildSshArgv,
} from "./ssh-host-access.mjs";
import { sshKeysMaintainEnabledFromConfig } from "../../../packages/infrastructure/proxmox/lib/proxmox-ssh-keys-maintain.mjs";

describe("ssh-host-access", () => {
  it("vaultKeyForProxmoxSshPassword uses host id suffix", () => {
    expect(vaultKeyForProxmoxSshPassword("hypervisor-a")).toBe("HDC_PROXMOX_SSH_PASSWORD_HYPERVISOR_A");
  });

  it("remoteInstallAuthorizedKeysBash is idempotent grep-based", () => {
    const script = remoteInstallAuthorizedKeysBash([Buffer.from("ssh-ed25519 AAAA test", "utf8").toString("base64")]);
    expect(script).toContain("authorized_keys");
    expect(script).toContain("grep -qxF");
  });

  it("buildSshArgv uses publickey mode without password", () => {
    const { args } = buildSshArgv(
      { user: "root", host: "192.0.2.1" },
      { mode: "pubkey", identities: [{ privateKey: "/home/x/.ssh/id_ed25519" }] },
    );
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("-i");
    expect(args.join(" ")).not.toContain("PubkeyAuthentication=no");
  });

  it("discoverLocalSshMaterial returns arrays", () => {
    const m = discoverLocalSshMaterial("/nonexistent-ssh-dir");
    expect(m.publicKeyLines).toEqual([]);
    expect(m.identities).toEqual([]);
  });

  it("sshKeysMaintainEnabledFromConfig respects enabled flag", () => {
    expect(sshKeysMaintainEnabledFromConfig({ provision: { ssh_keys: { enabled: false } } })).toBe(false);
    expect(sshKeysMaintainEnabledFromConfig({ provision: {} })).toBe(true);
  });
});
