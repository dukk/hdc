import { describe, expect, it } from "vitest";
import {
  hostOsMaintainEnabledFromConfig,
  hostOsRebootWaitMsFromConfig,
  listProxmoxHypervisorSshTargets,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-host-os-maintain.mjs";

describe("proxmox host OS maintain", () => {
  const cfg = {
    clusters: [
      {
        id: "c1",
        hosts: [
          { id: "pve-a", pve_node: "pve-a", ip: "10.0.0.1", web_ui: "https://10.0.0.1:8006", ssh: "ssh://root@10.0.0.1" },
          { id: "pve-b", pve_node: "pve-b", ip: "10.0.0.2", web_ui: "https://10.0.0.2:8006", ssh: "ssh://root@10.0.0.2" },
        ],
      },
    ],
  };

  it("listProxmoxHypervisorSshTargets dedupes and parses ssh URLs", () => {
    const t = listProxmoxHypervisorSshTargets(cfg, {});
    expect(t.map((x) => x.id)).toEqual(["pve-a", "pve-b"]);
    expect(t[0]).toEqual({ id: "pve-a", user: "root", host: "10.0.0.1", clusterId: "c1" });
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
