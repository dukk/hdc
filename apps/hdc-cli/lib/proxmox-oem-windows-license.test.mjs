import { describe, expect, it } from "vitest";
import {
  buildOemLicenseProbeScript,
  normalizeOemTableRef,
  oemLicenseWarningsForHost,
  oemWindowsLicenseEnabledFromConfig,
  parseOemLicenseProbeOutput,
  summarizeOemLicenseHost,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-oem-windows-license.mjs";

describe("proxmox-oem-windows-license", () => {
  it("oemWindowsLicenseEnabledFromConfig respects enabled flag", () => {
    expect(
      oemWindowsLicenseEnabledFromConfig({ provision: { oem_windows_license: { enabled: false } } }),
    ).toBe(false);
    expect(oemWindowsLicenseEnabledFromConfig({ provision: {} })).toBe(true);
  });

  it("buildOemLicenseProbeScript quotes node name", () => {
    const script = buildOemLicenseProbeScript("hypervisor-b");
    expect(script).toContain("HDC_OEM_BEGIN");
    expect(script).toContain("'hypervisor-b'");
  });

  it("parseOemLicenseProbeOutput handles no tables", () => {
    const out = `HDC_OEM_BEGIN
FIRMWARE_MSDM=0
FIRMWARE_SLIC=0
HDC_OEM_END`;
    const p = parseOemLicenseProbeOutput(out, "hypervisor-a");
    expect(p.firmware).toEqual({ msdm: false, slic: false });
    expect(p.dumpedTables).toEqual([]);
    expect(p.assigned).toEqual([]);
    const s = summarizeOemLicenseHost({ firmware: p.firmware, dumpedTables: p.dumpedTables, assigned: p.assigned });
    expect(s.status).toBe("none");
  });

  it("parseOemLicenseProbeOutput detects MSDM firmware only", () => {
    const out = `HDC_OEM_BEGIN
FIRMWARE_MSDM=1
FIRMWARE_SLIC=0
HDC_OEM_END`;
    const p = parseOemLicenseProbeOutput(out, "hypervisor-b");
    expect(p.firmware.msdm).toBe(true);
    const s = summarizeOemLicenseHost({ firmware: p.firmware, dumpedTables: [], assigned: [] });
    expect(s.status).toBe("firmware_only");
  });

  it("parseOemLicenseProbeOutput detects dump and single VM assignment", () => {
    const out = `HDC_OEM_BEGIN
FIRMWARE_MSDM=1
FIRMWARE_SLIC=0
DUMPED_TABLE=MSDM_table
VM_ASSIGNED vmid=100 table=MSDM_table
HDC_OEM_END`;
    const p = parseOemLicenseProbeOutput(out, "hypervisor-b");
    expect(p.dumpedTables).toEqual(["MSDM_table"]);
    expect(p.assigned).toEqual([{ vmid: 100, tableRef: "MSDM_table" }]);
    const s = summarizeOemLicenseHost({
      firmware: p.firmware,
      dumpedTables: p.dumpedTables,
      assigned: p.assigned,
    });
    expect(s.status).toBe("assigned");
  });

  it("summarizeOemLicenseHost flags multi_assigned", () => {
    const s = summarizeOemLicenseHost({
      firmware: { msdm: true, slic: false },
      dumpedTables: ["MSDM_table"],
      assigned: [
        { vmid: 100, tableRef: "MSDM_table" },
        { vmid: 101, tableRef: "MSDM_table" },
      ],
    });
    expect(s.status).toBe("multi_assigned");
    const host = {
      hostId: "hypervisor-b",
      pveNode: "hypervisor-b",
      clusterId: "c1",
      firmware: { msdm: true, slic: false },
      dumpedTables: ["MSDM_table"],
      assigned: [
        { vmid: 100, tableRef: "MSDM_table" },
        { vmid: 101, tableRef: "MSDM_table" },
      ],
      status: s.status,
      summary: s.summary,
    };
    expect(oemLicenseWarningsForHost(host).some((w) => w.includes("multiple VMs"))).toBe(true);
  });

  it("summarizeOemLicenseHost flags assigned_without_firmware", () => {
    const s = summarizeOemLicenseHost({
      firmware: { msdm: false, slic: false },
      dumpedTables: [],
      assigned: [{ vmid: 100, tableRef: "MSDM_table" }],
    });
    expect(s.status).toBe("assigned_without_firmware");
  });

  it("normalizeOemTableRef strips directory path", () => {
    expect(normalizeOemTableRef("/etc/pve/nodes/pve/qemu-server/MSDM_table")).toBe("MSDM_table");
    expect(normalizeOemTableRef("SLIC_table")).toBe("SLIC_table");
  });
});
