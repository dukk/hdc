import { describe, expect, it } from "vitest";
import {
  createMaintainReportContext,
  recordStep,
  renderMaintainReportMarkdown,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-maintain-report.mjs";

describe("proxmox-maintain-report", () => {
  it("renderMaintainReportMarkdown includes steps and storage alerts", () => {
    const ctx = createMaintainReportContext(["--dry-run"]);
    ctx.exitCode = 0;
    ctx.reportPath = "packages/infrastructure/proxmox/reports/maintain-test.md";
    recordStep(ctx, {
      id: "ssh-keys",
      title: "SSH public keys",
      ran: true,
      ok: true,
    });
    recordStep(ctx, {
      id: "storage",
      title: "NAS storage ensure",
      ran: false,
      skipReason: "--skip-storage",
    });
    ctx.capacity = {
      ok: true,
      warnings: [],
      clusters: [
        {
          id: "proxmox-primary-cluster",
          hosts: [
            {
              id: "pve-b",
              pveNode: "pve-b",
              clusterId: "proxmox-primary-cluster",
              guests: [],
              totals: { maxcpu: 0, maxmem: 0, maxdisk: 0 },
              capacity: { cpuCount: 12, memoryBytes: 64 * 1024 ** 3 },
              loadPercent: { cpu: 0, mem: 0, disk: null },
              rootfs: {
                total: 100_000_000_000,
                used: 96_000_000_000,
                avail: 4_000_000_000,
                usedPercent: 96,
                headroom: "critical — almost full",
              },
              storagePools: [
                {
                  id: "nas-1",
                  type: "nfs",
                  total: 500_000_000_000,
                  used: 430_000_000_000,
                  avail: 70_000_000_000,
                  usedPercent: 86,
                  headroom: "low — plan cleanup or pool expansion",
                },
              ],
              storageCapacityBytes: 500_000_000_000,
            },
          ],
        },
      ],
    };

    const md = renderMaintainReportMarkdown(ctx);
    expect(md).toContain("# Proxmox maintain report");
    expect(md).toContain("SSH public keys");
    expect(md).toContain("skipped (--skip-storage)");
    expect(md).toContain("## Steps executed");
    expect(md).toContain("## Storage and disk usage");
    expect(md).toContain("CRITICAL");
    expect(md).toContain("Root filesystem on pve-b");
    expect(md).toContain("Storage nas-1 on pve-b");
    expect(md).toContain("Dry run:** yes");
  });

  it("lists down hosts from context", () => {
    const ctx = createMaintainReportContext([]);
    ctx.downHosts = ["pve-a"];
    ctx.exitCode = 0;
    const md = renderMaintainReportMarkdown(ctx);
    expect(md).toContain("## Hosts marked down in config");
    expect(md).toContain("`pve-a`");
  });
});
