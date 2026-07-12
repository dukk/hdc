import { describe, expect, it } from "vitest";
import {
  hostOsMaintainEnabledFromConfig,
  hostOsRebootWaitMsFromConfig,
  listProxmoxHypervisorSshTargets,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-host-os-maintain.mjs";

describe("proxmox host OS maintain", () => {
  const cfg = {
    clusters: [
      {
        id: "c1",
        hosts: [
          { id: "hypervisor-a", pve_node: "hypervisor-a", ip: "192.0.2.1", web_ui: "https://192.0.2.1:8006", ssh: "ssh://root@192.0.2.1" },
          { id: "hypervisor-b", pve_node: "hypervisor-b", ip: "192.0.2.2", web_ui: "https://192.0.2.2:8006", ssh: "ssh://root@192.0.2.2" },
        ],
      },
    ],
  };

  it("listProxmoxHypervisorSshTargets dedupes and parses ssh URLs", () => {
    const t = listProxmoxHypervisorSshTargets(cfg, {});
    expect(t.map((x) => x.id)).toEqual(["hypervisor-a", "hypervisor-b"]);
    expect(t[0]).toEqual({ id: "hypervisor-a", user: "root", host: "192.0.2.1", clusterId: "c1" });
  });

  it("hostOsRebootWaitMsFromConfig reads reboot_wait_seconds", () => {
    expect(hostOsRebootWaitMsFromConfig({ provision: { host_os: { reboot_wait_seconds: 120 } } })).toBe(
      120_000,
    );
    expect(hostOsRebootWaitMsFromConfig({})).toBe(300_000);
  });

  it("hostOsMaintainEnabledFromConfig respects enabled flag", () => {
    expect(hostOsMaintainEnabledFromConfig({ provision: { host_os: { enabled: false } } })).toBe(false);
    expect(hostOsMaintainEnabledFromConfig({ provision: {} })).toBe(true);
  });

});
