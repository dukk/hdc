import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listN8nDeploymentSummaries,
  normalizeN8nConfig,
  resolveN8nDeployments,
} from "hdc/clump/services/n8n/lib/deployments.mjs";

const baseCfg = {
  schema_version: 2,
  defaults: {
    mode: "proxmox-lxc",
    n8n: {
      image_tag: "1.0.0",
      public_url: "https://n8n.example.invalid",
    },
  },
  deployments: [
    {
      system_id: "n8n-a",
      proxmox: { host_id: "hypervisor-a", lxc: { vmid: 490 } },
    },
  ],
};

describe("n8n deployments", () => {
  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeN8nConfig(baseCfg);
    expect(deployments[0].system_id).toBe("n8n-a");
  });

  it("rejects vm system_id", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].system_id = "vm-n8n-a";
    expect(() => normalizeN8nConfig(bad)).toThrow(/n8n/);
  });

  it("rejects invalid public_url", () => {
    const bad = structuredClone(baseCfg);
    bad.defaults.n8n.public_url = "not-a-url";
    expect(() => normalizeN8nConfig(bad)).toThrow(/URL/);
  });

  it("requires positive vmid", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].proxmox.lxc.vmid = 0;
    expect(() => normalizeN8nConfig(bad)).toThrow(/vmid/);
  });

  it("resolveN8nDeployments instance flag", () => {
    const list = resolveN8nDeployments(baseCfg, { instance: "a" });
    expect(list[0].systemId).toBe("n8n-a");
  });

  it("instanceFlagToSystemId", () => {
    expect(instanceFlagToSystemId("a")).toBe("n8n-a");
    expect(instanceFlagToSystemId("n8n-a")).toBe("n8n-a");
  });

  it("listN8nDeploymentSummaries", () => {
    const list = listN8nDeploymentSummaries(baseCfg);
    expect(list[0].system_id).toBe("n8n-a");
    expect(list[0].public_url).toBe("https://n8n.example.invalid");
    expect(list[0].host_port).toBe(5678);
  });
});
