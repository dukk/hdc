import { describe, expect, it } from "vitest";
import {
  createMaintainReportContext,
  isConfiguredCpuCritPct,
  isConfiguredCpuWarnPct,
  pushWarning,
  recordStep,
  renderMaintainReportMarkdown,
  renderOemWindowsLicenseMarkdown,
  renderQemuGuestAgentMarkdown,
  renderTemplateChecksMarkdown,
  splitMaintainSummaryFlags,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-maintain-report.mjs";
import { UBUNTU_LTS_RELEASES } from "../../../clumps/infrastructure/proxmox/lib/ubuntu-lts-catalog.mjs";

describe("proxmox-maintain-report", () => {
  it("splitMaintainSummaryFlags groups CLI flags into set and not set", () => {
    const { set, notSet } = splitMaintainSummaryFlags({
      dryRun: true,
      skipSshKeys: false,
      skipApiToken: true,
      skipTemplates: false,
      skipStorage: false,
      skipLocalLvm: false,
      skipOsUpdates: false,
      skipOemLicense: false,
      skipLoadReport: false,
      skipBootstrap: false,
      noDownload: false,
      noBuildQemu: false,
      noPrune: false,
      noReport: false,
      reportPath: "/tmp/report.md",
    });
    expect(set).toEqual(["--dry-run", "--skip-api-token", "--report (/tmp/report.md)"]);
    expect(notSet).toContain("--skip-ssh-keys");
    expect(notSet).not.toContain("--dry-run");
  });

  it("renderMaintainReportMarkdown includes steps and storage alerts", () => {
    const ctx = createMaintainReportContext(["--dry-run"]);
    ctx.exitCode = 0;
    ctx.reportPath = "clumps/infrastructure/proxmox/reports/maintain-test.md";
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
          id: "example-proxmox-cluster",
          hosts: [
            {
              id: "hypervisor-b",
              pveNode: "hypervisor-b",
              clusterId: "example-proxmox-cluster",
              guestsRunning: [],
              guestsNotRunning: [],
              guestsExcluded: [],
              counts: { running: 0, notRunning: 0, total: 0, excluded: 0 },
              totalsRunning: { maxcpu: 0, maxmem: 0, maxdisk: 0 },
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
                  id: "nas-a",
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
    expect(md).toContain("## Summary flags");
    expect(md).toContain("- **Set:** --dry-run");
    expect(md).toContain("- **Not set:**");
    expect(md).toContain("--skip-ssh-keys");
    expect(md).not.toContain("| `dryRun` |");
    expect(md).toContain("## Steps executed");
    expect(md).toContain("## Storage and disk usage");
    expect(md).toContain("CRITICAL");
    expect(md).toContain("Root filesystem on hypervisor-b");
    expect(md).toContain("Storage nas-a on hypervisor-b");
    expect(md).toContain("Dry run:** yes");
    expect(md).toContain("##### Running");
    expect(md).toContain("##### Not running");
    expect(md).toContain("**Running:** 0");
  });

  it("renderMaintainReportMarkdown includes OEM Windows license section", () => {
    const ctx = createMaintainReportContext([]);
    ctx.exitCode = 0;
    ctx.oemWindowsLicense = [
      {
        hostId: "hypervisor-b",
        pveNode: "hypervisor-b",
        clusterId: "c1",
        firmware: { msdm: true, slic: false },
        dumpedTables: ["MSDM_table"],
        assigned: [{ vmid: 100, tableRef: "MSDM_table" }],
        status: "assigned",
        summary: "VM 100 uses MSDM_table (firmware MSDM)",
      },
      {
        hostId: "hypervisor-c",
        pveNode: "hypervisor-c",
        clusterId: "c1",
        firmware: { msdm: false, slic: false },
        dumpedTables: [],
        assigned: [],
        status: "none",
        summary: "No OEM Windows ACPI table (MSDM/SLIC) on host",
      },
    ];
    pushWarning(ctx, "hypervisor-a: OEM Windows license (MSDM) available but not passed through to any VM");

    const md = renderMaintainReportMarkdown(ctx);
    expect(md).toContain("## OEM Windows license (SLIC/MSDM)");
    expect(md).toContain("| hypervisor-b |");
    expect(md).toContain("MSDM_table");
    expect(md).toContain("| hypervisor-c |");
    expect(md).toContain("not passed through");
  });

  it("renderOemWindowsLicenseMarkdown renders table rows", () => {
    const lines = renderOemWindowsLicenseMarkdown([
      {
        hostId: "hypervisor-b",
        pveNode: "hypervisor-b",
        clusterId: null,
        firmware: { msdm: true, slic: false },
        dumpedTables: [],
        assigned: [],
        status: "firmware_only",
        summary: "Firmware MSDM present; not assigned to any VM",
      },
    ]);
    expect(lines.join("\n")).toContain("firmware_only");
    expect(lines.join("\n")).toContain("MSDM");
  });

  it("renderMaintainReportMarkdown lists excluded templates and running load", () => {
    const ctx = createMaintainReportContext([]);
    ctx.exitCode = 0;
    ctx.capacity = {
      ok: true,
      warnings: [],
      clusters: [
        {
          id: "c1",
          hosts: [
            {
              id: "hypervisor-b",
              pveNode: "hypervisor-b",
              clusterId: "c1",
              guestsRunning: [
                {
                  vmid: 100,
                  name: "app",
                  type: "qemu",
                  node: "hypervisor-b",
                  status: "running",
                  maxcpu: 4,
                  maxmem: 8 * 1024 ** 3,
                  maxdisk: 50 * 1024 ** 3,
                },
              ],
              guestsNotRunning: [],
              guestsExcluded: [{ vmid: 9022, name: "tpl-ubuntu-2204", type: "qemu" }],
              counts: { running: 1, notRunning: 0, total: 1, excluded: 1 },
              totalsRunning: { maxcpu: 4, maxmem: 8 * 1024 ** 3, maxdisk: 50 * 1024 ** 3 },
              totals: { maxcpu: 4, maxmem: 8 * 1024 ** 3, maxdisk: 50 * 1024 ** 3 },
              capacity: { cpuCount: 8, memoryBytes: 32 * 1024 ** 3 },
              loadPercent: { cpu: 50, mem: 25, disk: 10 },
              rootfs: null,
              storagePools: [],
              storageCapacityBytes: 500 * 1024 ** 3,
            },
          ],
        },
      ],
    };
    const md = renderMaintainReportMarkdown(ctx);
    expect(md).toContain("Excluded templates");
    expect(md).toContain("tpl-ubuntu-2204");
    expect(md).toContain("running guests only");
    expect(md).toContain("| 100 | app |");
  });

  it("configured vCPU alerts warn at 100% and critical at 200%", () => {
    expect(isConfiguredCpuWarnPct(99)).toBe(false);
    expect(isConfiguredCpuWarnPct(100)).toBe(true);
    expect(isConfiguredCpuCritPct(199)).toBe(false);
    expect(isConfiguredCpuCritPct(200)).toBe(true);

    const hostBase = {
      id: "hypervisor-b",
      pveNode: "hypervisor-b",
      clusterId: "c1",
      guestsRunning: [],
      guestsNotRunning: [],
      guestsExcluded: [],
      counts: { running: 0, notRunning: 0, total: 0, excluded: 0 },
      totalsRunning: { maxcpu: 24, maxmem: 0, maxdisk: 0 },
      totals: { maxcpu: 24, maxmem: 0, maxdisk: 0 },
      capacity: { cpuCount: 12, memoryBytes: 64 * 1024 ** 3 },
      rootfs: null,
      storagePools: [],
      storageCapacityBytes: 0,
    };

    const ctxWarn = createMaintainReportContext([]);
    ctxWarn.exitCode = 0;
    ctxWarn.capacity = {
      ok: true,
      warnings: [],
      clusters: [{ id: "c1", hosts: [{ ...hostBase, loadPercent: { cpu: 150, mem: 0, disk: null } }] }],
    };
    const mdWarn = renderMaintainReportMarkdown(ctxWarn);
    expect(mdWarn).toContain("WARNING** Configured vCPU on hypervisor-b: 150%");
    expect(mdWarn).not.toContain("CRITICAL** Configured vCPU");

    const ctxCrit = createMaintainReportContext([]);
    ctxCrit.exitCode = 0;
    ctxCrit.capacity = {
      ok: true,
      warnings: [],
      clusters: [{ id: "c1", hosts: [{ ...hostBase, loadPercent: { cpu: 200, mem: 0, disk: null } }] }],
    };
    const mdCrit = renderMaintainReportMarkdown(ctxCrit);
    expect(mdCrit).toContain("CRITICAL** Configured vCPU on hypervisor-b: 200%");
  });

  it("renderTemplateChecksMarkdown lists expected catalog and per-node LXC results", () => {
    const policy = {
      lxcStorage: "local",
      defaultRelease: "22.04",
      entries: UBUNTU_LTS_RELEASES,
    };
    const lines = renderTemplateChecksMarkdown(
      [
        {
          cluster: "example-proxmox-cluster",
          kind: "lxc",
          release: "22.04",
          node: "hypervisor-b",
          expected_appliance: "ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
          expected_volid: "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst",
          ok: true,
        },
        {
          cluster: "example-proxmox-cluster",
          kind: "qemu",
          release: "22.04",
          template_vmid: 9022,
          template_name: "tpl-ubuntu-2204",
          node: "hypervisor-b",
          ok: true,
          built: false,
        },
      ],
      policy,
      false,
    );
    const md = lines.join("\n");
    expect(md).toContain("### Expected templates (policy)");
    expect(md).toContain("ubuntu-22.04-standard_22.04-1_amd64.tar.zst");
    expect(md).toContain("tpl-ubuntu-2204");
    expect(md).toContain("| 22.04 | `local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst` | hypervisor-b | OK |");
    expect(md).toContain("| 22.04 | 9022 | `tpl-ubuntu-2204` | hypervisor-b | OK |");
  });

  it("lists down hosts from context", () => {
    const ctx = createMaintainReportContext([]);
    ctx.downHosts = ["hypervisor-a"];
    ctx.exitCode = 0;
    const md = renderMaintainReportMarkdown(ctx);
    expect(md).toContain("## Hosts marked down in config");
    expect(md).toContain("`hypervisor-a`");
  });

  it("renderQemuGuestAgentMarkdown and full report include guest agent section", () => {
    const report = {
      ok: true,
      warnings: [],
      clusters: [
        {
          id: "example-proxmox-cluster",
          hosts: [
            {
              hostId: "hypervisor-b",
              pveNode: "hypervisor-b",
              guests: [
                {
                  vmid: 100,
                  name: "app-a",
                  node: "hypervisor-b",
                  status: "running",
                  configEnabled: true,
                  agentStatus: "ok",
                  summary: "agent enabled and responding",
                },
                {
                  vmid: 101,
                  name: "app-b",
                  node: "hypervisor-b",
                  status: "running",
                  configEnabled: true,
                  agentStatus: "not_responding",
                  summary: "agent enabled in config but guest agent not responding",
                },
              ],
            },
          ],
        },
      ],
    };
    const section = renderQemuGuestAgentMarkdown(report).join("\n");
    expect(section).toContain("## QEMU guest agent");
    expect(section).toContain("| 100 | app-a | running | ok | enabled |");
    expect(section).toContain("not_responding");
    expect(section).toContain("**Summary:** 1 ok, 1 not_responding");

    const ctx = createMaintainReportContext([]);
    ctx.exitCode = 0;
    ctx.qemuGuestAgent = report;
    const md = renderMaintainReportMarkdown(ctx);
    expect(md).toContain("## QEMU guest agent");
    expect(md).toContain("LXC containers are omitted");
  });

  it("splitMaintainSummaryFlags includes skip-guest-agent when set", () => {
    const { set } = splitMaintainSummaryFlags({
      dryRun: false,
      skipSshKeys: false,
      skipApiToken: false,
      skipTemplates: false,
      skipStorage: false,
      skipLocalLvm: false,
      skipOsUpdates: false,
      skipOemLicense: false,
      skipLoadReport: false,
      skipGuestAgent: true,
      skipBootstrap: false,
      noDownload: false,
      noBuildQemu: false,
      noPrune: false,
      noReport: false,
    });
    expect(set).toContain("--skip-guest-agent");
  });
});
