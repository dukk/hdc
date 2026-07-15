import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  discoverLocalSshMaterial,
  remoteInstallAuthorizedKeysBash,
  vaultKeyForProxmoxSshPassword,
  buildSshArgv,
  createSshAskpassHelper,
} from "./ssh-host-access.mjs";
import { sshKeysMaintainEnabledFromConfig } from "hdc/clump/infrastructure/proxmox/lib/proxmox-ssh-keys-maintain.mjs";

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

  it("buildSshArgv password mode limits password prompts", () => {
    const { args } = buildSshArgv({ user: "admin", host: "192.0.2.1" }, { mode: "password" });
    expect(args.join(" ")).toContain("NumberOfPasswordPrompts=1");
    expect(args.join(" ")).toContain("PubkeyAuthentication=no");
  });

  it("createSshAskpassHelper emits password bytes without trailing newline", () => {
    const secret = "p@ssw0rd-no-nl";
    const helper = createSshAskpassHelper(secret);
    try {
      const r = spawnSync(helper.path, [], {
        env: { ...process.env, ...helper.env },
        encoding: "buffer",
        shell: process.platform === "win32",
      });
      expect(r.status).toBe(0);
      const out = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(String(r.stdout ?? ""), "utf8");
      expect(out.toString("utf8")).toBe(secret);
      expect(out[out.length - 1]).not.toBe(0x0a);
      expect(out[out.length - 1]).not.toBe(0x0d);
    } finally {
      helper.cleanup();
    }
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
