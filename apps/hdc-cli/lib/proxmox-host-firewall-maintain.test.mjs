import { describe, expect, it } from "vitest";
import {
  HDC_FIREWALL_MARKER_BEGIN,
  HDC_FIREWALL_MARKER_END,
  buildHostFirewallHdcSection,
  hostFirewallAllowedCidrsFromConfig,
  hostFirewallJobsFromConfig,
  hostFirewallMaintainEnabledFromConfig,
  hostFirewallPathForNode,
  ipv4InCidr,
  mergeHdcFirewallSection,
  normalizeSourceCidr,
  resolveMaintainSourceAllowed,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-host-firewall-maintain.mjs";

const fixtureCfg = {
  schema_version: 1,
  clusters: [
    {
      id: "example-proxmox-cluster",
      hosts: [
        {
          id: "hypervisor-b",
          pve_node: "hypervisor-b",
          ip: "192.0.2.12",
          web_ui: "https://192.0.2.12:8006",
          ssh: "ssh://root@192.0.2.12",
        },
        {
          id: "hypervisor-c",
          pve_node: "hypervisor-c",
          ip: "192.0.2.13",
          web_ui: "https://192.0.2.13:8006",
          ssh: "ssh://root@192.0.2.13",
        },
      ],
    },
    {
      id: "example-proxmox-standalone",
      hosts: [
        {
          id: "hypervisor-h",
          pve_node: "hypervisor-h",
          ip: "192.0.2.14",
          web_ui: "https://192.0.2.14:8006",
          ssh: "ssh://root@192.0.2.14",
        },
      ],
    },
  ],
  provision: {
    host_firewall: {
      enabled: true,
      allowed_source_cidrs: ["192.0.2.0/24", "198.51.100.0/24", "198.51.101.0/24"],
      ssh_port: 22,
      web_port: 8006,
    },
  },
};

describe("proxmox host firewall maintain", () => {
  it("normalizeSourceCidr maps UniFi gateway notation to network CIDR", () => {
    expect(normalizeSourceCidr("192.0.2.1/24")).toBe("192.0.2.0/24");
    expect(normalizeSourceCidr("192.0.2.0/24")).toBe("192.0.2.0/24");
  });

  it("ipv4InCidr matches addresses inside allowed subnets", () => {
    expect(ipv4InCidr("192.0.2.50", "192.0.2.0/24")).toBe(true);
    expect(ipv4InCidr("198.51.100.10", "198.51.100.0/24")).toBe(true);
    expect(ipv4InCidr("192.168.1.10", "192.0.2.0/24")).toBe(false);
  });

  it("resolveMaintainSourceAllowed uses SSH_CLIENT when present", () => {
    expect(
      resolveMaintainSourceAllowed({
        sshClientIp: "192.0.2.50",
        localIps: [],
        allowedCidrs: ["192.0.2.0/24"],
      }).allowed,
    ).toBe(true);

    expect(
      resolveMaintainSourceAllowed({
        sshClientIp: "203.0.113.1",
        localIps: ["192.0.2.2"],
        allowedCidrs: ["192.0.2.0/24"],
      }).allowed,
    ).toBe(false);

    expect(
      resolveMaintainSourceAllowed({
        sshClientIp: null,
        localIps: ["198.51.100.20"],
        allowedCidrs: ["198.51.100.0/24"],
      }).allowed,
    ).toBe(true);
  });

  it("hostFirewallMaintainEnabledFromConfig and allowed CIDRs", () => {
    expect(hostFirewallMaintainEnabledFromConfig(fixtureCfg)).toBe(true);
    expect(
      hostFirewallMaintainEnabledFromConfig({
        ...fixtureCfg,
        provision: { host_firewall: { enabled: false } },
      }),
    ).toBe(false);
    expect(hostFirewallAllowedCidrsFromConfig(fixtureCfg)).toEqual([
      "192.0.2.0/24",
      "198.51.100.0/24",
      "198.51.101.0/24",
    ]);
  });

  it("buildHostFirewallHdcSection emits ACCEPT and DROP rules", () => {
    const section = buildHostFirewallHdcSection({
      cidrs: ["192.0.2.0/24", "198.51.100.0/24"],
      sshPort: 22,
      webPort: 8006,
    });
    expect(section).toContain(HDC_FIREWALL_MARKER_BEGIN);
    expect(section).toContain(HDC_FIREWALL_MARKER_END);
    expect(section).toContain("IN SSH(ACCEPT) -source 192.0.2.0/24,198.51.100.0/24");
    expect(section).toContain("IN ACCEPT -p tcp -dport 8006 -source 192.0.2.0/24,198.51.100.0/24");
    expect(section).toContain("IN DROP -p tcp -dport 22");
    expect(section).toContain("IN DROP -p tcp -dport 8006");
  });

  it("mergeHdcFirewallSection replaces marker block and preserves outside content", () => {
    const existing = [
      "[OPTIONS]",
      "enable: 0",
      "",
      HDC_FIREWALL_MARKER_BEGIN,
      "old rules",
      HDC_FIREWALL_MARKER_END,
      "",
      "# operator rule",
    ].join("\n");

    const section = buildHostFirewallHdcSection({
      cidrs: ["192.0.2.0/24"],
      sshPort: 22,
      webPort: 8006,
    });
    const merged = mergeHdcFirewallSection(existing, section);
    expect(merged).toContain("# operator rule");
    expect(merged).toContain("IN SSH(ACCEPT) -source 192.0.2.0/24");
    expect(merged).not.toContain("old rules");
  });

  it("mergeHdcFirewallSection appends when no markers exist", () => {
    const merged = mergeHdcFirewallSection(
      "[OPTIONS]\nenable: 0\n",
      buildHostFirewallHdcSection({ cidrs: ["192.0.2.0/24"], sshPort: 22, webPort: 8006 }),
    );
    expect(merged).toContain("enable: 0");
    expect(merged).toContain(HDC_FIREWALL_MARKER_BEGIN);
  });

  it("hostFirewallJobsFromConfig uses cluster.fw for multi-node clusters", () => {
    const jobs = hostFirewallJobsFromConfig(fixtureCfg, { HDC_PROXMOX_SSH_USER: "root" });
    const clusterJob = jobs.find((j) => j.mode === "cluster");
    const hostJob = jobs.find((j) => j.mode === "host");
    expect(clusterJob?.fwPath).toBe("/etc/pve/firewall/cluster.fw");
    expect(clusterJob?.memberIds).toEqual(["hypervisor-b", "hypervisor-c"]);
    expect(hostJob?.fwPath).toBe(hostFirewallPathForNode("hypervisor-h"));
    expect(hostJob?.memberIds).toEqual(["hypervisor-h"]);
  });
});
