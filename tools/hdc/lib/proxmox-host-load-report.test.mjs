import { describe, expect, it } from "vitest";
import {
  aggregateGuestsByNode,
  buildHostCapacityReport,
  computeLoadPercent,
  formatBytes,
  formatGuestLine,
  formatHostLoadSummary,
  guestConfigFromResource,
  guestsFromResourceRows,
  headroomLabel,
  isExcludedFromLoadReport,
  isGuestResource,
  nodeCapacityFromStatus,
  mergeStoragePoolsForNode,
  nodeStorageCapacityBytes,
  partitionGuestsByRunState,
  rootfsFromNodeStatus,
  storageAppliesToNode,
  storagePoolsForNode,
  storageUsageRowFromApiRow,
  sumGuestResources,
  usagePercent,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-host-load-report.mjs";

const pveBStatus = {
  cpuinfo: { cpus: 12 },
  memory: { total: 67199479808 },
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

  it("isExcludedFromLoadReport matches tpl- names and hdc template vmids", () => {
    expect(isExcludedFromLoadReport({ type: "qemu", name: "tpl-ubuntu-2204", vmid: 9022 })).toBe(
      true,
    );
    expect(isExcludedFromLoadReport(portainerGuest)).toBe(false);
    expect(isExcludedFromLoadReport({ ...portainerGuest, template: 1 })).toBe(true);
  });

  it("guestsFromResourceRows excludes templates from workload", () => {
    const tpl = {
      type: "qemu",
      node: "hypervisor-b",
      vmid: 9022,
      name: "tpl-ubuntu-2204",
      status: "stopped",
      maxcpu: 4,
      maxmem: 4294967296,
      maxdisk: 34359738368,
      template: 0,
    };
    const { workload, excluded } = guestsFromResourceRows([portainerGuest, tpl]);
    expect(workload).toHaveLength(1);
    expect(workload[0].vmid).toBe(107);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].vmid).toBe(9022);
  });

  it("partitionGuestsByRunState splits running vs stopped", () => {
    const running = guestConfigFromResource({ ...portainerGuest, status: "running" });
    const stopped = guestConfigFromResource(portainerGuest);
    const { running: r, notRunning } = partitionGuestsByRunState([running, stopped].filter(Boolean));
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("running");
    expect(notRunning).toHaveLength(1);
    expect(notRunning[0].status).toBe("stopped");
  });

  it("buildHostCapacityReport uses running-only totals for loadPercent", () => {
    const running = guestConfigFromResource({ ...portainerGuest, status: "running", maxcpu: 4 });
    const stopped = guestConfigFromResource({ ...portainerGuest, status: "stopped", vmid: 108, name: "other" });
    const host = buildHostCapacityReport([running, stopped].filter(Boolean), [], {
      id: "hypervisor-c",
      pveNode: "hypervisor-c",
      clusterId: "c1",
      capacity: { cpuCount: 12, memoryBytes: 64 * 1024 ** 3 },
      rootfs: null,
      storagePools: [],
      storageCapacityBytes: 100_000_000_000,
    });
    expect(host.counts).toEqual({ running: 1, notRunning: 1, total: 2, excluded: 0 });
    expect(host.totalsRunning.maxcpu).toBe(4);
    expect(host.totals.maxcpu).toBe(10);
    expect(host.loadPercent.cpu).toBe(33);
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

  it("storageAppliesToNode treats empty nodes as all nodes", () => {
    expect(storageAppliesToNode("", "hypervisor-b")).toBe(true);
    expect(storageAppliesToNode(undefined, "hypervisor-c")).toBe(true);
    expect(storageAppliesToNode("hypervisor-a,hypervisor-b", "hypervisor-b")).toBe(true);
    expect(storageAppliesToNode("hypervisor-a", "hypervisor-b")).toBe(false);
  });

  it("storagePoolsForNode includes storages with empty nodes list", () => {
    const pools = storagePoolsForNode(
      [
        { storage: "local", type: "dir", nodes: "", total: 4_000_000_000, used: 1_000_000_000, enabled: 1 },
        { storage: "nas-a", type: "cifs", nodes: "hypervisor-c", total: 1, enabled: 1 },
      ],
      "hypervisor-b",
    );
    expect(pools.map((p) => p.id)).toEqual(["local"]);
  });

  it("mergeStoragePoolsForNode prefers node API bytes for local-lvm", () => {
    const clusterRows = [
      {
        storage: "local-lvm",
        type: "lvmthin",
        nodes: "",
        total: 0,
        used: 0,
        enabled: 1,
      },
      { storage: "nas-a", type: "cifs", nodes: "hypervisor-b", total: 0, used: 0, enabled: 1 },
    ];
    const nodeRows = [
      {
        storage: "local-lvm",
        type: "lvmthin",
        total: 200_000_000_000,
        used: 150_000_000_000,
        avail: 50_000_000_000,
        enabled: 1,
      },
      {
        storage: "local",
        type: "dir",
        total: 8_000_000_000,
        used: 2_000_000_000,
        avail: 6_000_000_000,
        enabled: 1,
      },
    ];
    const pools = mergeStoragePoolsForNode(clusterRows, nodeRows, "hypervisor-b");
    const lvm = pools.find((p) => p.id === "local-lvm");
    const local = pools.find((p) => p.id === "local");
    expect(lvm?.total).toBe(200_000_000_000);
    expect(lvm?.usedPercent).toBe(75);
    expect(local?.total).toBe(8_000_000_000);
    expect(pools.map((p) => p.id)).toEqual(["local", "local-lvm", "nas-a"]);
  });

  it("storageUsageRowFromApiRow skips disabled storage", () => {
    expect(storageUsageRowFromApiRow({ storage: "local", enabled: 0 })).toBeNull();
    expect(storageUsageRowFromApiRow({ storage: "local", enabled: 1, total: 1 })?.id).toBe("local");
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
    expect(summary).toContain("Configured load (running guests only):");
    expect(summary).toContain("CPU 6/12 (50%)");
    expect(summary).toMatch(/RAM .* \(.*%\)/);
    expect(summary).toMatch(/disk .* \(.*%\)/);
  });
});
