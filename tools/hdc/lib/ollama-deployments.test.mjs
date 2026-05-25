import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listOllamaDeploymentSummaries,
  normalizeOllamaConfig,
  resolveOllamaDeployment,
  resolveOllamaDeployments,
} from "../../../packages/services/ollama/lib/deployments.mjs";

describe("ollama deployments", () => {
  const v2 = {
    schema_version: 2,
    defaults: { mode: "proxmox-lxc", proxmox: { lxc: { memory_mb: 4096, cores: 2, rootfs_gb: 32 } } },
    deployments: [
      { system_id: "ct-ollama-a", proxmox: { host_id: "pve-d", lxc: { vmid: 470 } } },
      { system_id: "ct-ollama-b", proxmox: { host_id: "pve-c", lxc: { vmid: 471 } } },
    ],
  };

  it("normalizes v2 and merges defaults", () => {
    const { deployments } = normalizeOllamaConfig(v2);
    expect(deployments).toHaveLength(2);
    expect(deployments[0].proxmox).toMatchObject({ host_id: "pve-d", lxc: { vmid: 470, memory_mb: 4096 } });
  });

  it("returns all deployments when no selector", () => {
    const list = resolveOllamaDeployments(v2, {});
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.systemId)).toEqual(["ct-ollama-a", "ct-ollama-b"]);
  });

  it("accepts full system id in --instance", () => {
    expect(instanceFlagToSystemId("ct-ollama-b")).toBe("ct-ollama-b");
    expect(instanceFlagToSystemId("b")).toBe("ct-ollama-b");
  });

  it("resolves by --instance", () => {
    const d = resolveOllamaDeployment(v2, { instance: "b" });
    expect(d.systemId).toBe("ct-ollama-b");
    expect(d.proxmox?.host_id).toBe("pve-c");
  });

  it("adapts legacy v1 config", () => {
    const v1 = {
      deploy: { mode: "proxmox-lxc", system_id: "ct-ollama-a" },
      proxmox: { host_id: "pve-d", lxc: { vmid: 470, memory_mb: 8192, cores: 4, rootfs_gb: 48 } },
    };
    const { deployments } = normalizeOllamaConfig(v1);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("ct-ollama-a");
  });

  it("lists deployment summaries", () => {
    const list = listOllamaDeploymentSummaries(v2);
    expect(list.map((x) => x.system_id)).toEqual(["ct-ollama-a", "ct-ollama-b"]);
  });

  it("honors --skip-install", () => {
    const d = resolveOllamaDeployment(v2, { instance: "a", "skip-install": "1" });
    expect(d.install.enabled).toBe(false);
  });
});
