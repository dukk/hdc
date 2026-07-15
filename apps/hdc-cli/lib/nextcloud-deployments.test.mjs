import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listNextcloudDeploymentSummaries,
  normalizeNextcloudConfig,
  resolveNextcloudDeployments,
} from "hdc/clump/services/nextcloud/lib/deployments.mjs";

describe("nextcloud deployments", () => {
  const v2 = {
    schema_version: 2,
    defaults: {
      mode: "proxmox-lxc",
      proxmox: { lxc: { rootfs_gb: 64, memory_mb: 8192, cores: 4 } },
      nextcloud: {
        aio: { image_channel: "latest", interface_host_port: 8080 },
      },
    },
    deployments: [
      {
        system_id: "nextcloud-a",
        proxmox: { host_id: "hypervisor-a", lxc: { vmid: 487 } },
      },
    ],
  };

  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeNextcloudConfig(v2);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("nextcloud-a");
  });

  it("rejects invalid system_id prefix", () => {
    expect(() =>
      normalizeNextcloudConfig({
        schema_version: 2,
        deployments: [{ system_id: "vm-nextcloud-a", proxmox: { host_id: "hypervisor-a", lxc: { vmid: 1 } } }],
      }),
    ).toThrow(/nextcloud/);
  });

  it("resolves single deployment", () => {
    const list = resolveNextcloudDeployments(v2, {});
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("nextcloud-a");
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("a")).toBe("nextcloud-a");
    expect(instanceFlagToSystemId("nextcloud-a")).toBe("nextcloud-a");
  });

  it("lists deployment summaries", () => {
    const list = listNextcloudDeploymentSummaries(v2);
    expect(list[0]).toMatchObject({
      system_id: "nextcloud-a",
      host_id: "hypervisor-a",
      vmid: 487,
      interface_host_port: 8080,
      reverse_proxy: false,
    });
  });
});
