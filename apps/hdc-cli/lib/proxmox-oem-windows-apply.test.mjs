import { describe, expect, it } from "vitest";
import {
  buildAcpitableArgs,
  buildOemTableDumpScript,
  formatSmbios1Param,
  parseHostSmbiosOutput,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-oem-windows-apply.mjs";

describe("proxmox-oem-windows-apply", () => {
  it("buildOemTableDumpScript references node qemu-server dir", () => {
    const script = buildOemTableDumpScript("pve-b");
    expect(script).toContain('NODE=\'pve-b\'');
    expect(script).toContain("/etc/pve/nodes/$NODE/qemu-server");
    expect(script).toContain("MSDM_table");
  });

  it("formatSmbios1Param builds PVE smbios1 string", () => {
    const s = formatSmbios1Param({
      uuid: "11111111-2222-3333-4444-555555555555",
      manufacturer: "Dell Inc.",
      product: "OptiPlex",
      version: "1.0",
      serial: "ABC123",
      sku: "SKU1",
      family: "Family",
    });
    expect(s).toContain("uuid=11111111-2222-3333-4444-555555555555");
    expect(s).toContain("manufacturer=Dell Inc.");
    expect(s).toContain("serial=ABC123");
  });

  it("buildAcpitableArgs joins acpitable file args", () => {
    expect(
      buildAcpitableArgs(["/etc/pve/nodes/pve-b/qemu-server/MSDM_table"]),
    ).toBe("-acpitable file=/etc/pve/nodes/pve-b/qemu-server/MSDM_table");
  });

  it("parseHostSmbiosOutput reads dmidecode markers", () => {
    const out = `HDC_SMBIOS_BEGIN
SMBIOS_UUID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
SMBIOS_MANUFACTURER=ACME
SMBIOS_PRODUCT=Box
SMBIOS_SERIAL=SN1
HDC_SMBIOS_END`;
    const f = parseHostSmbiosOutput(out);
    expect(f.uuid).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(f.manufacturer).toBe("ACME");
    expect(f.product).toBe("Box");
    expect(f.serial).toBe("SN1");
  });
});
