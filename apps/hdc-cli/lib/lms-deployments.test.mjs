import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listLmsDeploymentSummaries,
  normalizeLmsConfig,
  resolveLmsDeployments,
} from "hdc/clump/services/lms/lib/deployments.mjs";

describe("lms deployments", () => {
  const v2Qemu = {
    schema_version: 2,
    defaults: {
      mode: "proxmox-qemu",
      proxmox: { qemu: { template_vmid: 9022, memory_mb: 16384 } },
      lms: { models: ["openai/gpt-oss-20b"], server: { port: 1234 } },
    },
    deployments: [
      {
        system_id: "vm-lms-a",
        proxmox: {
          host_id: "hypervisor-d",
          qemu: {
            vmid: 475,
            template_vmid: 9022,
            ip: "192.0.2.28/24",
          },
        },
        configure: { ssh: { host: "192.0.2.28" } },
      },
    ],
  };

  it("normalizes vm-lms-a deployment", () => {
    const { deployments } = normalizeLmsConfig(v2Qemu);
    expect(deployments[0].system_id).toBe("vm-lms-a");
    expect(deployments[0].proxmox?.qemu?.vmid).toBe(475);
  });

  it("rejects non-vm system_id", () => {
    expect(() =>
      normalizeLmsConfig({
        deployments: [
          {
            system_id: "lms-a",
            proxmox: {
              host_id: "hypervisor-d",
              qemu: { vmid: 475, template_vmid: 9022, ip: "192.0.2.28/24" },
            },
          },
        ],
      }),
    ).toThrow(/vm-lms/);
  });

  it("rejects proxmox-lxc mode", () => {
    expect(() =>
      normalizeLmsConfig({
        deployments: [
          {
            system_id: "vm-lms-a",
            mode: "proxmox-lxc",
            proxmox: {
              host_id: "hypervisor-d",
              qemu: { vmid: 475, template_vmid: 9022, ip: "192.0.2.28/24" },
            },
          },
        ],
      }),
    ).toThrow(/proxmox-qemu/);
  });

  it("instance a resolves to vm-lms-a", () => {
    expect(instanceFlagToSystemId("a", v2Qemu.deployments)).toBe("vm-lms-a");
    expect(instanceFlagToSystemId("vm-lms-a", v2Qemu.deployments)).toBe("vm-lms-a");
  });

  it("resolveLmsDeployments merges lms models", () => {
    const list = resolveLmsDeployments(v2Qemu, { instance: "a" });
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("vm-lms-a");
    expect(list[0].lms.models).toEqual(["openai/gpt-oss-20b"]);
    expect(list[0].lms.server.port).toBe(1234);
  });

  it("listLmsDeploymentSummaries includes model count", () => {
    const summaries = listLmsDeploymentSummaries(v2Qemu);
    expect(summaries[0].model_count).toBe(1);
    expect(summaries[0].server_port).toBe(1234);
  });
});
