import { describe, expect, it } from "vitest";
import {
  aggregateGuestsByNode,
  computeLoadPercent,
  formatBytes,
  formatGuestLine,
  formatHostLoadSummary,
  guestConfigFromResource,
  headroomLabel,
  isGuestResource,
  nodeCapacityFromStatus,
  nodeStorageCapacityBytes,
  rootfsFromNodeStatus,
  storagePoolsForNode,
  sumGuestResources,
  usagePercent,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-host-load-report.mjs";

const pveBStatus = {
  cpuinfo: { cpus: 12 },
  memory: { total: 67199479808 },
  rootfs: { total: 100861726720, used: 21925924864, avail: 78935801956 },
};

const portainerGuest = {
  type: "qemu",
  node: "hypervisor-c",
  vmid: 107,
  name: "portainer-a",
  status: "stopped",
  maxcpu: 6,
  maxmem: 17179869184,
  maxdisk: 137438953472,
  template: 0,
};

describe("proxmox-host-load-report", () => {
  it("isGuestResource excludes templates and non-vm types", () => {
    expect(isGuestResource(portainerGuest)).toBe(true);
    expect(isGuestResource({ ...portainerGuest, template: 1 })).toBe(false);
    expect(isGuestResource({ ...portainerGuest, type: "storage" })).toBe(false);
  });

  it("guestConfigFromResource parses cluster resource row", () => {
    const g = guestConfigFromResource(portainerGuest);
    expect(g).toEqual({
      vmid: 107,
      name: "portainer-a",
      type: "qemu",
      node: "hypervisor-c",
      maxcpu: 6,
      maxmem: 17179869184,
      maxdisk: 137438953472,
    });
  });

  it("nodeCapacityFromStatus reads cpu and memory from node_status", () => {
    const cap = nodeCapacityFromStatus(pveBStatus);
    expect(cap.cpuCount).toBe(12);
    expect(cap.memoryBytes).toBe(67199479808);
  });

  it("nodeStorageCapacityBytes sums totals for storages on node", () => {
    const rows = [
      { storage: "local", nodes: "hypervisor-b", total: 100_000_000_000, enabled: 1 },
      { storage: "nas-a", nodes: "hypervisor-a,hypervisor-b", total: 500_000_000_000, enabled: 1 },
      { storage: "iso", nodes: "hypervisor-c", total: 50_000_000_000, enabled: 1 },
    ];
    expect(nodeStorageCapacityBytes(rows, "hypervisor-b")).toBe(600_000_000_000);
    expect(nodeStorageCapacityBytes(rows, "hypervisor-c")).toBe(50_000_000_000);
    expect(nodeStorageCapacityBytes(rows, "pve-z")).toBe(0);
  });

  it("storagePoolsForNode includes storages assigned to the node", () => {
    const pools = storagePoolsForNode(
      [
        { storage: "local", type: "dir", nodes: "hypervisor-b", total: 4_000_000_000, used: 1_000_000_000, enabled: 1 },
        { storage: "nas-a", type: "cifs", nodes: "hypervisor-c", total: 1, enabled: 1 },
      ],
      "hypervisor-b",
    );
    expect(pools.map((p) => p.id)).toEqual(["local"]);
  });

  it("aggregateGuestsByNode and sumGuestResources", () => {
    const g1 = guestConfigFromResource(portainerGuest);
    const g2 = guestConfigFromResource({
      ...portainerGuest,
      vmid: 200,
      name: "other",
      node: "hypervisor-b",
      maxcpu: 2,
      maxmem: 2147483648,
      maxdisk: 34359738368,
    });
    const byNode = aggregateGuestsByNode([g1, g2].filter(Boolean));
    expect(byNode.get("hypervisor-c")?.length).toBe(1);
    expect(byNode.get("hypervisor-b")?.length).toBe(1);
    const totals = sumGuestResources(byNode.get("hypervisor-c") ?? []);
    expect(totals.maxcpu).toBe(6);
    expect(totals.maxmem).toBe(17179869184);
  });

  it("computeLoadPercent and formatBytes", () => {
    expect(computeLoadPercent(24, 12)).toBe(200);
    expect(computeLoadPercent(1, 0)).toBeNull();
    expect(formatBytes(17179869184)).toBe("16.0 GiB");
  });

  it("rootfsFromNodeStatus and storagePoolsForNode", () => {
    const rootfs = rootfsFromNodeStatus(pveBStatus);
    expect(rootfs?.total).toBe(100861726720);
    expect(rootfs?.used).toBe(21925924864);
    expect(rootfs?.usedPercent).toBe(22);
    expect(rootfs?.headroom).toBe("headroom available");

    const pools = storagePoolsForNode(
      [
        {
          storage: "local-lvm",
          type: "lvmthin",
          nodes: "hypervisor-b",
          total: 100_000_000_000,
          used: 96_000_000_000,
          avail: 4_000_000_000,
          enabled: 1,
        },
      ],
      "hypervisor-b",
    );
    expect(pools[0].usedPercent).toBe(96);
    expect(pools[0].headroom).toBe("critical — almost full");
  });

  it("usagePercent and headroomLabel", () => {
    expect(usagePercent(85, 100)).toBe(85);
    expect(headroomLabel(85)).toBe("low — plan cleanup or pool expansion");
    expect(headroomLabel(96)).toBe("critical — almost full");
    expect(headroomLabel(10)).toBe("headroom available");
  });

  it("formatGuestLine and formatHostLoadSummary", () => {
    const g = guestConfigFromResource(portainerGuest);
    expect(formatGuestLine(g)).toContain("vmid 107");
    expect(formatGuestLine(g)).toContain("16.0 GiB RAM");

    const totals = sumGuestResources([g]);
    const capacity = nodeCapacityFromStatus(pveBStatus);
    const summary = formatHostLoadSummary({
      totals,
      capacity,
      storageCapacityBytes: 500_000_000_000,
    });
    expect(summary).toContain("Configured load:");
    expect(summary).toContain("CPU 6/12 (50%)");
    expect(summary).toMatch(/RAM .* \(.*%\)/);
    expect(summary).toMatch(/disk .* \(.*%\)/);
  });
});
