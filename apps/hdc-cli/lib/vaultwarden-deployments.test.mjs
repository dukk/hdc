import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listVaultwardenDeploymentSummaries,
  normalizeVaultwardenConfig,
  resolveVaultwardenDeployments,
} from "hdc/clump/services/vaultwarden/lib/deployments.mjs";

const baseCfg = {
  schema_version: 2,
  defaults: {
    mode: "proxmox-lxc",
    vaultwarden: {
      image_tag: "1.34.0",
      domain: "https://vault.example.invalid",
    },
  },
  deployments: [
    {
      system_id: "vaultwarden-a",
      proxmox: { host_id: "hypervisor-a", lxc: { vmid: 487 } },
    },
  ],
};

describe("vaultwarden deployments", () => {
  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeVaultwardenConfig(baseCfg);
    expect(deployments[0].system_id).toBe("vaultwarden-a");
  });

  it("rejects vm system_id", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].system_id = "vm-vaultwarden-a";
    expect(() => normalizeVaultwardenConfig(bad)).toThrow(/vaultwarden/);
  });

  it("requires https domain", () => {
    const bad = structuredClone(baseCfg);
    bad.defaults.vaultwarden.domain = "http://vault.example.invalid";
    expect(() => normalizeVaultwardenConfig(bad)).toThrow(/https/);
  });

  it("resolveVaultwardenDeployments instance flag", () => {
    const list = resolveVaultwardenDeployments(baseCfg, { instance: "a" });
    expect(list[0].systemId).toBe("vaultwarden-a");
  });

  it("instanceFlagToSystemId", () => {
    expect(instanceFlagToSystemId("a")).toBe("vaultwarden-a");
    expect(instanceFlagToSystemId("vaultwarden-a")).toBe("vaultwarden-a");
  });

  it("listVaultwardenDeploymentSummaries", () => {
    const list = listVaultwardenDeploymentSummaries(baseCfg);
    expect(list[0].system_id).toBe("vaultwarden-a");
    expect(list[0].domain).toBe("https://vault.example.invalid");
    expect(list[0].host_port).toBe(80);
    expect(list[0].signups_allowed).toBe(false);
  });
});
