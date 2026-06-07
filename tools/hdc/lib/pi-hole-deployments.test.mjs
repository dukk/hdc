import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listPiHoleDeploymentSummaries,
  normalizePiHoleConfig,
  resolvePiHoleDeployments,
} from "../../../packages/services/pi-hole/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  defaults: {
    mode: "proxmox-lxc",
    proxmox: {
      lxc: {
        memory_mb: 1024,
        cores: 1,
        rootfs_gb: 8,
      },
    },
    pihole: {
      upstream_dns: ["1.1.1.1"],
    },
    install: { enabled: true },
  },
  deployments: [
    {
      system_id: "pi-hole-a",
      proxmox: { host_id: "hypervisor-b", lxc: { vmid: 110 } },
    },
    {
      system_id: "pi-hole-b",
      proxmox: { host_id: "hypervisor-c", lxc: { vmid: 112 } },
    },
  ],
};

describe("pi-hole deployments", () => {
  it("normalizes deployments[] with defaults merge", () => {
    const { deployments } = normalizePiHoleConfig(sampleCfg);
    expect(deployments).toHaveLength(2);
    expect(deployments[0].system_id).toBe("pi-hole-a");
    expect(deployments[0].mode).toBe("proxmox-lxc");
    expect(deployments[0].proxmox.host_id).toBe("hypervisor-b");
  });

  it("rejects duplicate system_id", () => {
    expect(() =>
      normalizePiHoleConfig({
        deployments: [
          { system_id: "pi-hole-a", proxmox: { host_id: "hypervisor-b", lxc: { vmid: 1 } } },
          { system_id: "pi-hole-a", proxmox: { host_id: "hypervisor-c", lxc: { vmid: 2 } } },
        ],
      }),
    ).toThrow(/duplicate system_id/);
  });

  it("rejects invalid system_id pattern", () => {
    expect(() =>
      normalizePiHoleConfig({
        deployments: [{ system_id: "vm-pi-hole-a", proxmox: { host_id: "hypervisor-b", lxc: { vmid: 1 } } }],
      }),
    ).toThrow(/pi-hole/);
  });

  it("lists deployment summaries", () => {
    const list = listPiHoleDeploymentSummaries(sampleCfg);
    expect(list).toEqual([
      expect.objectContaining({
        system_id: "pi-hole-a",
        host_id: "hypervisor-b",
        vmid: 110,
        install_enabled: true,
      }),
      expect.objectContaining({
        system_id: "pi-hole-b",
        host_id: "hypervisor-c",
        vmid: 112,
      }),
    ]);
  });

  it("resolves all deployments by default", () => {
    const list = resolvePiHoleDeployments(sampleCfg, {});
    expect(list.map((d) => d.systemId)).toEqual(["pi-hole-a", "pi-hole-b"]);
  });

  it("resolves --instance b to pi-hole-b", () => {
    const list = resolvePiHoleDeployments(sampleCfg, { instance: "b" });
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("pi-hole-b");
  });

  it("instanceFlagToSystemId maps letter to full id", () => {
    expect(instanceFlagToSystemId("a")).toBe("pi-hole-a");
    expect(instanceFlagToSystemId("pi-hole-b")).toBe("pi-hole-b");
  });

  it("honors --skip-install", () => {
    const list = resolvePiHoleDeployments(sampleCfg, { "skip-install": "1" });
    expect(list.every((d) => d.install.enabled === false)).toBe(true);
  });

  it("merges defaults allowlist with per-deployment override", () => {
    const { deployments } = normalizePiHoleConfig({
      ...sampleCfg,
      defaults: {
        ...sampleCfg.defaults,
        pihole: {
          ...sampleCfg.defaults.pihole,
          allowlist: ["marketingplatform.google.com", "analytics.google.com"],
        },
      },
      deployments: [
        sampleCfg.deployments[0],
        {
          ...sampleCfg.deployments[1],
          pihole: { allowlist: ["www.googletagmanager.com"] },
        },
      ],
    });
    expect(deployments[0].pihole.allowlist).toEqual([
      "marketingplatform.google.com",
      "analytics.google.com",
    ]);
    expect(deployments[1].pihole.allowlist).toEqual(["www.googletagmanager.com"]);
  });
});
