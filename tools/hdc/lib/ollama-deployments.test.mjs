import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listOllamaDeploymentSummaries,
  normalizeOllamaConfig,
  resolveOllamaDeployment,
  resolveOllamaDeployments,
} from "../../../packages/services/ollama/lib/deployments.mjs";

describe("ollama deployments", () => {
  const v2Lxc = {
    schema_version: 2,
    defaults: { mode: "proxmox-lxc", proxmox: { lxc: { memory_mb: 4096, cores: 2, rootfs_gb: 64 } } },
    deployments: [
      { system_id: "ollama-b", proxmox: { host_id: "hypervisor-c", lxc: { vmid: 471 } } },
      { system_id: "ollama-c", proxmox: { host_id: "hypervisor-b", lxc: { vmid: 472 } } },
    ],
  };

  const v2Qemu = {
    schema_version: 2,
    defaults: { mode: "proxmox-qemu" },
    deployments: [
      {
        system_id: "vm-ollama-a",
        mode: "proxmox-qemu",
        proxmox: {
          host_id: "hypervisor-d",
          qemu: {
            vmid: 470,
            template_vmid: 9024,
            ip: "192.0.2.25/24",
            hostpci: [{ id: "0000:03:00.0", pcie: true, rombar: false }],
          },
        },
        configure: { ssh: { host: "192.0.2.25" } },
        install: { gpu: true, gpu_backend: "nvidia" },
      },
    ],
  };

  it("normalizes v2 LXC and merges defaults", () => {
    const { deployments } = normalizeOllamaConfig(v2Lxc);
    expect(deployments).toHaveLength(2);
    expect(deployments[0].proxmox).toMatchObject({ host_id: "hypervisor-c", lxc: { vmid: 471, memory_mb: 4096 } });
  });

  it("normalizes vm-ollama-a with hostpci", () => {
    const { deployments } = normalizeOllamaConfig(v2Qemu);
    expect(deployments[0].system_id).toBe("vm-ollama-a");
    const hostpci = deployments[0].proxmox?.qemu?.hostpci;
    expect(Array.isArray(hostpci)).toBe(true);
    expect(hostpci).toHaveLength(1);
    expect(hostpci[0].id).toBe("0000:03:00.0");
  });

  it("rejects ollama- id with proxmox-qemu mode", () => {
    expect(() =>
      normalizeOllamaConfig({
        deployments: [
          {
            system_id: "ollama-a",
            mode: "proxmox-qemu",
            proxmox: {
              host_id: "hypervisor-d",
              qemu: { vmid: 470, template_vmid: 9024, ip: "192.0.2.0/24" },
            },
            configure: { ssh: { host: "192.0.2.1" } },
          },
        ],
      }),
    ).toThrow(/vm-ollama/);
  });

  it("returns all LXC deployments when no selector", () => {
    const list = resolveOllamaDeployments(v2Lxc, {});
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.systemId)).toEqual(["ollama-b", "ollama-c"]);
  });

  it("instance a resolves to vm-ollama-a when configured as QEMU", () => {
    const { deployments } = normalizeOllamaConfig(v2Qemu);
    expect(instanceFlagToSystemId("a", deployments)).toBe("vm-ollama-a");
    expect(instanceFlagToSystemId("vm-ollama-a", deployments)).toBe("vm-ollama-a");
  });

  it("accepts full system id in --instance for LXC", () => {
    const { deployments } = normalizeOllamaConfig(v2Lxc);
    expect(instanceFlagToSystemId("ollama-b", deployments)).toBe("ollama-b");
    expect(instanceFlagToSystemId("b", deployments)).toBe("ollama-b");
  });

  it("resolves QEMU deployment by --instance", () => {
    const d = resolveOllamaDeployment(v2Qemu, { instance: "a" });
    expect(d.systemId).toBe("vm-ollama-a");
    expect(d.mode).toBe("proxmox-qemu");
  });

  it("adapts legacy v1 config", () => {
    const v1 = {
      deploy: { mode: "proxmox-lxc", system_id: "ollama-a" },
      proxmox: { host_id: "hypervisor-d", lxc: { vmid: 470, memory_mb: 8192, cores: 4, rootfs_gb: 64 } },
    };
    const { deployments } = normalizeOllamaConfig(v1);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("ollama-a");
  });

  it("lists deployment summaries", () => {
    const list = listOllamaDeploymentSummaries(v2Lxc);
    expect(list.map((x) => x.system_id)).toEqual(["ollama-b", "ollama-c"]);
  });

  it("honors --skip-install", () => {
    const d = resolveOllamaDeployment(v2Lxc, { instance: "b", "skip-install": "1" });
    expect(d.install.enabled).toBe(false);
  });

  it("accepts rootfs_gb at minimum", () => {
    expect(() => normalizeOllamaConfig(v2Lxc)).not.toThrow();
    const { deployments } = normalizeOllamaConfig(v2Lxc);
    expect(deployments[0].proxmox?.lxc).toMatchObject({ rootfs_gb: 64 });
  });
});
