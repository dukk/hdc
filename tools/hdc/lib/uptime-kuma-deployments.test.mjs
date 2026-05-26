import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listUptimeKumaDeploymentSummaries,
  normalizeUptimeKumaConfig,
  resolveUptimeKumaDeployments,
} from "../../../packages/services/uptime-kuma/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  defaults: {
    mode: "proxmox-lxc",
    proxmox: {
      lxc: {
        memory_mb: 1024,
        cores: 1,
        rootfs_gb: 4,
      },
    },
    uptime_kuma: {
      port: 3001,
      release: "latest",
    },
    install: { enabled: true },
  },
  deployments: [
    {
      system_id: "uptime-kuma-a",
      proxmox: { host_id: "hypervisor-b", lxc: { vmid: 115 } },
    },
  ],
};

describe("uptime-kuma deployments", () => {
  it("normalizes deployments[] with defaults merge", () => {
    const { deployments } = normalizeUptimeKumaConfig(sampleCfg);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("uptime-kuma-a");
    expect(deployments[0].mode).toBe("proxmox-lxc");
    expect(deployments[0].proxmox.host_id).toBe("hypervisor-b");
    expect(deployments[0].uptime_kuma.port).toBe(3001);
  });

  it("rejects invalid system_id pattern", () => {
    expect(() =>
      normalizeUptimeKumaConfig({
        deployments: [{ system_id: "vm-uptime-kuma-a", proxmox: { host_id: "hypervisor-b", lxc: { vmid: 1 } } }],
      }),
    ).toThrow(/uptime-kuma/);
  });

  it("lists deployment summaries", () => {
    const list = listUptimeKumaDeploymentSummaries(sampleCfg);
    expect(list).toEqual([
      expect.objectContaining({
        system_id: "uptime-kuma-a",
        host_id: "hypervisor-b",
        vmid: 115,
        install_enabled: true,
        port: 3001,
      }),
    ]);
  });

  it("resolves single deployment by default", () => {
    const list = resolveUptimeKumaDeployments(sampleCfg, {});
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("uptime-kuma-a");
  });

  it("instanceFlagToSystemId maps letter to full id", () => {
    expect(instanceFlagToSystemId("a")).toBe("uptime-kuma-a");
    expect(instanceFlagToSystemId("uptime-kuma-a")).toBe("uptime-kuma-a");
  });

  it("honors --skip-install", () => {
    const list = resolveUptimeKumaDeployments(sampleCfg, { "skip-install": "1" });
    expect(list.every((d) => d.install.enabled === false)).toBe(true);
  });
});
