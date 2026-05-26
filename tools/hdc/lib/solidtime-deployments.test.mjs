import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listSolidtimeDeploymentSummaries,
  normalizeSolidtimeConfig,
  normalizeVersionTag,
  resolveSolidtimeDeployments,
} from "../../../packages/services/solidtime/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  defaults: {
    mode: "proxmox-lxc",
    proxmox: {
      lxc: {
        memory_mb: 4096,
        cores: 4,
        rootfs_gb: 12,
      },
    },
    solidtime: {
      version: "v0.12.2",
    },
    install: { enabled: true },
  },
  deployments: [
    {
      system_id: "solidtime-a",
      proxmox: { host_id: "hypervisor-b", lxc: { vmid: 480 } },
    },
  ],
};

describe("solidtime deployments", () => {
  it("normalizes deployments[] with defaults merge", () => {
    const { deployments } = normalizeSolidtimeConfig(sampleCfg);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("solidtime-a");
    expect(deployments[0].mode).toBe("proxmox-lxc");
    expect(deployments[0].proxmox.host_id).toBe("hypervisor-b");
    expect(deployments[0].solidtime.version).toBe("v0.12.2");
  });

  it("rejects invalid system_id pattern", () => {
    expect(() =>
      normalizeSolidtimeConfig({
        deployments: [{ system_id: "vm-solidtime-a", proxmox: { host_id: "hypervisor-b", lxc: { vmid: 1 } } }],
      }),
    ).toThrow(/solidtime/);
  });

  it("lists deployment summaries", () => {
    const list = listSolidtimeDeploymentSummaries(sampleCfg);
    expect(list).toEqual([
      expect.objectContaining({
        system_id: "solidtime-a",
        host_id: "hypervisor-b",
        vmid: 480,
        version: "v0.12.2",
        install_enabled: true,
      }),
    ]);
  });

  it("resolves single deployment by default", () => {
    const list = resolveSolidtimeDeployments(sampleCfg, {});
    expect(list.map((d) => d.systemId)).toEqual(["solidtime-a"]);
  });

  it("resolves --instance a to solidtime-a", () => {
    const list = resolveSolidtimeDeployments(sampleCfg, { instance: "a" });
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("solidtime-a");
  });

  it("instanceFlagToSystemId maps letter to full id", () => {
    expect(instanceFlagToSystemId("a")).toBe("solidtime-a");
    expect(instanceFlagToSystemId("solidtime-a")).toBe("solidtime-a");
  });

  it("honors --skip-install", () => {
    const list = resolveSolidtimeDeployments(sampleCfg, { "skip-install": "1" });
    expect(list.every((d) => d.install.enabled === false)).toBe(true);
  });

  it("normalizeVersionTag adds v prefix", () => {
    expect(normalizeVersionTag("0.12.2")).toBe("v0.12.2");
    expect(normalizeVersionTag("v0.12.2")).toBe("v0.12.2");
  });
});
