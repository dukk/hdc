import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  hardwareFromProxmoxNodeStatus,
  mergeOemWindowsIntoHardware,
  oemWindowsHardwareEntry,
  resolveSystemSidecarWrite,
  upsertPhysicalSystemHardware,
} from "./hardware-inventory.mjs";

describe("oemWindowsHardwareEntry", () => {
  it("records presence without a full product key", () => {
    expect(
      oemWindowsHardwareEntry({
        oa3KeyPresent: true,
        partialProductKey: "XXXXX-YYYYY-ZZZZZ-AAAAA-BBBBB",
        channel: "OEM:DM",
      }),
    ).toMatchObject({
      type: "oem_windows",
      present: true,
      oa3_key_present: true,
      partial_product_key: "BBBBB",
      channel: "OEM:DM",
    });
  });

  it("records firmware MSDM/SLIC on Linux hosts", () => {
    expect(oemWindowsHardwareEntry({ firmwareMsdm: true, firmwareSlic: false })).toMatchObject({
      type: "oem_windows",
      present: true,
      firmware_msdm: true,
      firmware_slic: false,
    });
  });

  it("can record explicit absence", () => {
    expect(oemWindowsHardwareEntry({ firmwareMsdm: false, firmwareSlic: false, oa3KeyPresent: false })).toMatchObject({
      present: false,
      firmware_msdm: false,
      firmware_slic: false,
      oa3_key_present: false,
    });
  });
});

describe("hardwareFromProxmoxNodeStatus", () => {
  it("maps API cpuinfo and memory", () => {
    const hw = hardwareFromProxmoxNodeStatus({
      statusBody: {
        data: {
          cpuinfo: { modelname: "AMD EPYC", cpus: 32 },
          memory: { total: 64e9 },
        },
      },
      oemFirmware: { msdm: true, slic: false },
    });
    expect(hw.find((h) => h.type === "cpu")).toMatchObject({ model: "AMD EPYC", logical_cores: 32 });
    expect(hw.find((h) => h.type === "memory")).toMatchObject({ total_gb: 64 });
    expect(hw.find((h) => h.type === "oem_windows")).toMatchObject({
      present: true,
      firmware_msdm: true,
    });
  });

  it("prefers SSH hardware and merges OEM", () => {
    const hw = hardwareFromProxmoxNodeStatus({
      sshHardware: [
        { type: "system", manufacturer: "Supermicro" },
        { type: "cpu", model: "from-ssh", logical_cores: 16 },
      ],
      oemFirmware: { msdm: false, slic: true },
    });
    expect(hw.find((h) => h.type === "cpu")?.model).toBe("from-ssh");
    expect(hw.find((h) => h.type === "oem_windows")).toMatchObject({ firmware_slic: true });
  });
});

describe("resolveSystemSidecarWrite / upsert", () => {
  it("writes under operations/inventory/systems", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-hw-"));
    mkdirSync(join(root, "operations", "inventory", "systems"), { recursive: true });
    process.env.HDC_PRIVATE_ROOT = root;

    const resolved = resolveSystemSidecarWrite(root, "pve-a");
    expect(resolved.rel).toBe("operations/inventory/systems/pve-a.json");

    const result = upsertPhysicalSystemHardware({
      publicRoot: root,
      systemId: "pve-a",
      hardware: [{ type: "memory", total_gb: 32 }],
      tags: ["proxmox"],
      automationTargets: ["proxmox"],
      accessNode: { ip: "10.0.0.11" },
      source: "proxmox",
    });
    expect(result.rel).toBe("operations/inventory/systems/pve-a.json");
    expect(existsSync(result.path)).toBe(true);
    const data = JSON.parse(readFileSync(result.path, "utf8"));
    expect(data.system_class).toBe("physical");
    expect(data.hardware).toEqual([{ type: "memory", total_gb: 32 }]);
    expect(data.access.nodes[0].ip).toBe("10.0.0.11");
    expect(data.automation_targets).toContain("proxmox");

    delete process.env.HDC_PRIVATE_ROOT;
  });

  it("merges oem_windows into hardware arrays", () => {
    const merged = mergeOemWindowsIntoHardware(
      [{ type: "cpu", model: "x" }, { type: "oem_windows", present: false }],
      oemWindowsHardwareEntry({ firmwareMsdm: true }),
    );
    expect(merged.filter((h) => h.type === "oem_windows")).toHaveLength(1);
    expect(merged.find((h) => h.type === "oem_windows")?.present).toBe(true);
  });
});
