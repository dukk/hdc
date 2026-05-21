import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryCliDeps } from "../test/memory-cli-deps.mjs";
import { writeVault } from "../vault.mjs";
import { CliExit } from "./cli-exit.mjs";
import {
  bootstrapHostDocsFromInfrastructureConfigs,
  generateHdcPassword,
  inventoryIdToVaultSuffix,
  listSshTargetsFromSidecar,
  parseSshUrl,
  remoteBootstrapHdcBash,
  resolveSshTargetForNode,
  runUsersBootstrapHdc,
  sidecarMatchesBootstrapTags,
  sshUserFromAuthEnv,
  tagsFromSidecar,
  vaultKeyForHdcLocalPassword,
} from "./users-bootstrap-hdc.mjs";

describe("users-bootstrap-hdc helpers", () => {
  it("vaultKeyForHdcLocalPassword uppercases id segments", () => {
    expect(vaultKeyForHdcLocalPassword("proxmox-primary-cluster")).toBe(
      "HDC_USER_HDC_PASSWORD_PROXMOX_PRIMARY_CLUSTER",
    );
    expect(vaultKeyForHdcLocalPassword("pve-a")).toBe("HDC_USER_HDC_PASSWORD_PVE_A");
    expect(inventoryIdToVaultSuffix("  my-host  ")).toBe("MY_HOST");
  });

  it("parseSshUrl accepts ssh:// URLs", () => {
    expect(parseSshUrl("ssh://root@10.0.0.11")).toEqual({ user: "root", host: "10.0.0.11" });
    expect(parseSshUrl("ssh://10.0.0.11")).toEqual({ user: null, host: "10.0.0.11" });
    expect(parseSshUrl("https://x")).toBe(null);
    expect(parseSshUrl("")).toBe(null);
  });

  it("resolveSshTargetForNode prefers URL user over auth env", () => {
    const env = { HDC_PROXMOX_SSH_USER: "fromenv" };
    expect(
      resolveSshTargetForNode(
        { ssh: "ssh://root@10.0.0.1" },
        { ssh_user_env: "HDC_PROXMOX_SSH_USER" },
        env,
      ),
    ).toEqual({ host: "10.0.0.1", user: "root" });
    expect(
      resolveSshTargetForNode(
        { ssh: "ssh://10.0.0.2" },
        { ssh_user_env: "HDC_PROXMOX_SSH_USER" },
        env,
      ),
    ).toEqual({ host: "10.0.0.2", user: "fromenv" });
    expect(resolveSshTargetForNode({ ssh: "ssh://10.0.0.2" }, {}, env)).toBe(null);
  });

  it("sshUserFromAuthEnv reads env", () => {
    expect(sshUserFromAuthEnv({ ssh_user_env: "HDC_X" }, { HDC_X: "u" })).toBe("u");
    expect(sshUserFromAuthEnv({ ssh_user_env: "HDC_X" }, {})).toBe(null);
  });

  it("listSshTargetsFromSidecar collects nodes", () => {
    const sidecar = {
      access: {
        nodes: [{ ssh: "ssh://root@10.0.0.1" }, { name: "x" }],
      },
      auth: { ssh_user_env: "HDC_PROXMOX_SSH_USER" },
    };
    expect(listSshTargetsFromSidecar(sidecar, { HDC_PROXMOX_SSH_USER: "root" })).toEqual([
      { host: "10.0.0.1", user: "root" },
    ]);
  });

  it("tagsFromSidecar and sidecarMatchesBootstrapTags", () => {
    expect(sidecarMatchesBootstrapTags(["Proxmox", "other"])).toBe(true);
    expect(sidecarMatchesBootstrapTags(["ubuntu"])).toBe(true);
    expect(sidecarMatchesBootstrapTags(["debian"])).toBe(false);
    expect(tagsFromSidecar({ tags: ["a"] })).toEqual(["a"]);
  });

  it("remoteBootstrapHdcBash embeds base64 payload", () => {
    const s = remoteBootstrapHdcBash("YWJj");
    expect(s).toContain("base64 -d");
    expect(s).toContain("YWJj");
    expect(s).toContain("chpasswd");
  });
});

describe("bootstrapHostDocsFromInfrastructureConfigs", () => {
  it("loads ubuntu/proxmox package config bootstrap_hosts with proxmox/ubuntu tags", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-bootstrap-cfg-"));
    try {
      mkdirSync(join(root, "packages/infrastructure/ubuntu"), { recursive: true });
      mkdirSync(join(root, "packages/infrastructure/proxmox"), { recursive: true });
      writeFileSync(
        join(root, "packages/infrastructure/ubuntu/config.json"),
        JSON.stringify({
          schema_version: 1,
          bootstrap_hosts: [
            { id: "u1", kind: "system", tags: ["ubuntu"], access: { nodes: [] } },
            { id: "skip", tags: ["debian"], access: { nodes: [] } },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(root, "packages/infrastructure/proxmox/config.json"),
        JSON.stringify({
          schema_version: 1,
          bootstrap_hosts: [{ id: "p1", kind: "system", tags: ["proxmox"], access: { nodes: [] } }],
        }),
        "utf8",
      );
      const deps = createMemoryCliDeps({ root });
      const rows = bootstrapHostDocsFromInfrastructureConfigs(root, deps);
      expect(rows.map((r) => r.data.id)).toEqual(["u1", "p1"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("runUsersBootstrapHdc", () => {
  it("generates random passwords", () => {
    const a = generateHdcPassword();
    const b = generateHdcPassword();
    expect(a.length).toBeGreaterThan(16);
    expect(a).not.toBe(b);
  });

  it("throws CliExit on invalid JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-usb-"));
    try {
      mkdirSync(join(root, "inventory/manual/systems"), { recursive: true });
      const bad = join(root, "inventory/manual/systems/bad.json");
      writeFileSync(bad, "{", "utf8");
      const vaultPath = join(root, "v.enc");
      writeVault(vaultPath, "p", {});
      const deps = createMemoryCliDeps({
        root,
        defaultVaultPath: () => vaultPath,
        envVars: { HDC_VAULT_PASSPHRASE: "p" },
      });
      await expect(runUsersBootstrapHdc(["--sidecar", bad], deps)).rejects.toThrow(CliExit);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when vault unlock is aborted (empty passphrase)", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-usb-2"));
    try {
      mkdirSync(join(root, "inventory/manual/systems"), { recursive: true });
      writeFileSync(
        join(root, "inventory/manual/systems/x.json"),
        JSON.stringify({
          schema_version: 1,
          id: "x",
          kind: "system",
          tags: ["ubuntu"],
          auth: { ssh_user_env: "HDC_X" },
          access: { nodes: [{ ssh: "ssh://root@10.0.0.1" }] },
        }),
        "utf8",
      );
      const deps = createMemoryCliDeps({
        root,
        defaultVaultPath: () => join(root, "v.enc"),
        envVars: { HDC_X: "root" },
        readLineQuestion: async () => "",
      });
      await expect(
        runUsersBootstrapHdc(["--sidecar", "inventory/manual/systems/x.json"], deps),
      ).rejects.toThrow(CliExit);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when sidecar path is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-usb-3"));
    try {
      const deps = createMemoryCliDeps({
        root,
        defaultVaultPath: () => join(root, "v.enc"),
        envVars: { HDC_VAULT_PASSPHRASE: "pw" },
      });
      await expect(runUsersBootstrapHdc(["--sidecar", join(root, "nope.json")], deps)).rejects.toThrow(CliExit);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
