import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  normalizeAsteriskConfig,
  resolveAsteriskDeployments,
} from "../../../packages/services/asterisk/lib/deployments.mjs";

const baseCfg = {
  schema_version: 2,
  asterisk: { twilio: { enabled: true } },
  defaults: {
    mode: "proxmox-lxc",
    proxmox: {
      lxc: { vmid: 500, rootfs_gb: 16, memory_mb: 2048, cores: 2 },
    },
  },
  deployments: [
    {
      system_id: "asterisk-a",
      proxmox: { host_id: "hypervisor-a", lxc: { vmid: 500 } },
    },
    {
      system_id: "vm-asterisk-b",
      mode: "proxmox-qemu",
      proxmox: {
        host_id: "hypervisor-a",
        qemu: { vmid: 501, template_vmid: 9024, ip: "192.0.2.151/24" },
      },
      configure: { ssh: { host: "192.0.2.151" } },
    },
  ],
};

describe("asterisk deployments", () => {
  it("normalizeAsteriskConfig accepts LXC and QEMU ids", () => {
    const norm = normalizeAsteriskConfig(baseCfg);
    expect(norm.deployments).toHaveLength(2);
    expect(norm.asterisk.twilio.enabled).toBe(true);
  });

  it("rejects invalid system_id for mode", () => {
    expect(() =>
      normalizeAsteriskConfig({
        ...baseCfg,
        deployments: [
          {
            system_id: "vm-wrong-a",
            mode: "proxmox-lxc",
            proxmox: { host_id: "hypervisor-a", lxc: { vmid: 1 } },
          },
        ],
      }),
    ).toThrow(/asterisk-<letter>/);
  });

  it("instanceFlagToSystemId resolves letter to configured id", () => {
    expect(instanceFlagToSystemId("a", baseCfg.deployments)).toBe("asterisk-a");
    expect(instanceFlagToSystemId("b", baseCfg.deployments)).toBe("vm-asterisk-b");
  });

  it("resolveAsteriskDeployments filters by --instance", () => {
    const list = resolveAsteriskDeployments(baseCfg, { instance: "b" });
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("vm-asterisk-b");
    expect(list[0].mode).toBe("proxmox-qemu");
  });

  it("resolveAsteriskDeployments honors --skip-install", () => {
    const list = resolveAsteriskDeployments(baseCfg, { instance: "a", "skip-install": "1" });
    expect(list[0].install.enabled).toBe(false);
  });

  it("configure-only requires ssh host", () => {
    expect(() =>
      normalizeAsteriskConfig({
        schema_version: 2,
        deployments: [
          {
            system_id: "asterisk-a",
            mode: "configure-only",
          },
        ],
      }),
    ).toThrow(/configure\.ssh\.host/);
  });
});
