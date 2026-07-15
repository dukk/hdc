import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listOpenWebuiDeploymentSummaries,
  normalizeOpenWebuiConfig,
  resolveOpenWebuiDeployments,
} from "hdc/clump/services/open-webui/lib/deployments.mjs";

const baseCfg = {
  schema_version: 2,
  defaults: {
    mode: "proxmox-lxc",
    open_webui: {
      image_tag: "v0.6.26",
      ollama_backends: [{ id: "ollama-a", url: "http://192.0.2.25:11434" }],
    },
  },
  deployments: [
    {
      system_id: "open-webui-a",
      proxmox: { host_id: "hypervisor-a", lxc: { vmid: 486 } },
    },
  ],
};

describe("open-webui deployments", () => {
  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeOpenWebuiConfig(baseCfg);
    expect(deployments[0].system_id).toBe("open-webui-a");
  });

  it("rejects vm system_id", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].system_id = "vm-open-webui-a";
    expect(() => normalizeOpenWebuiConfig(bad)).toThrow(/open-webui/);
  });

  it("resolveOpenWebuiDeployments instance flag", () => {
    const list = resolveOpenWebuiDeployments(baseCfg, { instance: "a" });
    expect(list[0].systemId).toBe("open-webui-a");
  });

  it("instanceFlagToSystemId", () => {
    expect(instanceFlagToSystemId("a")).toBe("open-webui-a");
    expect(instanceFlagToSystemId("open-webui-a")).toBe("open-webui-a");
  });

  it("listOpenWebuiDeploymentSummaries", () => {
    const list = listOpenWebuiDeploymentSummaries(baseCfg);
    expect(list[0].system_id).toBe("open-webui-a");
    expect(list[0].ollama_backend_ids).toEqual(["ollama-a"]);
    expect(list[0].host_port).toBe(3000);
  });
});
