import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  normalizeOpenclawConfig,
  resolveOpenclawDeployments,
} from "../../../clumps/services/openclaw/lib/deployments.mjs";

describe("openclaw deployments", () => {
  const cfg = {
    schema_version: 2,
    defaults: {
      mode: "proxmox-qemu",
      proxmox: {
        qemu: { template_vmid: 9022, vmid: 580, ip: "192.0.2.50/24" },
      },
      openclaw: { version: "latest" },
    },
    deployments: [
      {
        system_id: "vm-openclaw-a",
        proxmox: { host_id: "hypervisor-a" },
      },
    ],
  };

  it("normalizes schema v2 deployments", () => {
    const norm = normalizeOpenclawConfig(cfg);
    expect(norm.schemaVersion).toBe(2);
    expect(norm.deployments[0].system_id).toBe("vm-openclaw-a");
  });

  it("maps --instance a to vm-openclaw-a", () => {
    expect(instanceFlagToSystemId("a", cfg.deployments)).toBe("vm-openclaw-a");
    const resolved = resolveOpenclawDeployments(cfg, { instance: "a" });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].systemId).toBe("vm-openclaw-a");
  });

  it("rejects invalid system_id pattern", () => {
    expect(() =>
      normalizeOpenclawConfig({
        schema_version: 2,
        deployments: [
          {
            system_id: "openclaw-a",
            proxmox: {
              host_id: "hypervisor-a",
              qemu: { vmid: 1, ip: "192.0.2.1/24", template_vmid: 9022 },
            },
          },
        ],
      }),
    ).toThrow(/vm-openclaw/);
  });
});
