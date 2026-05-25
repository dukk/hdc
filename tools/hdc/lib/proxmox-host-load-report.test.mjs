import { readFileSync } from "node:fs";
import { join } from "node:path";
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
} from "../../../packages/infrastructure/proxmox/lib/proxmox-host-load-report.mjs";

const pveBStatus = JSON.parse(
  readFileSync(join(process.cwd(), "inventory/automated/systems/pve-b.json"), "utf8"),
).query_last.node_status;

const portainerGuest = JSON.parse(
  readFileSync(join(process.cwd(), "inventory/automated/systems/vm-portainer-a.json"), "utf8"),
).virtual_hardware;

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
      node: "pve-c",
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
      { storage: "local", nodes: "pve-b", total: 100_000_000_000, enabled: 1 },
      { storage: "nas-1", nodes: "pve-a,pve-b", total: 500_000_000_000, enabled: 1 },
      { storage: "iso", nodes: "pve-c", total: 50_000_000_000, enabled: 1 },
    ];
    expect(nodeStorageCapacityBytes(rows, "pve-b")).toBe(600_000_000_000);
    expect(nodeStorageCapacityBytes(rows, "pve-c")).toBe(50_000_000_000);
    expect(nodeStorageCapacityBytes(rows, "pve-z")).toBe(0);
  });

  it("aggregateGuestsByNode and sumGuestResources", () => {
    const g1 = guestConfigFromResource(portainerGuest);
    const g2 = guestConfigFromResource({
      ...portainerGuest,
      vmid: 200,
      name: "other",
      node: "pve-b",
      maxcpu: 2,
      maxmem: 2147483648,
      maxdisk: 34359738368,
    });
    const byNode = aggregateGuestsByNode([g1, g2].filter(Boolean));
    expect(byNode.get("pve-c")?.length).toBe(1);
    expect(byNode.get("pve-b")?.length).toBe(1);
    const totals = sumGuestResources(byNode.get("pve-c") ?? []);
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
          nodes: "pve-b",
          total: 100_000_000_000,
          used: 96_000_000_000,
          avail: 4_000_000_000,
          enabled: 1,
        },
      ],
      "pve-b",
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
