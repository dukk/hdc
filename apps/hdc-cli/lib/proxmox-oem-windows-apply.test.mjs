import { describe, expect, it } from "vitest";
import {
  buildAcpitableArgs,
  buildHostSmbiosProbeScript,
  buildOemTableDumpScript,
  formatSmbios1Param,
  parseHostSmbiosOutput,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-oem-windows-apply.mjs";

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
    expect(s).toContain(`manufacturer=${Buffer.from("Dell Inc.").toString("base64")}`);
    expect(s).toContain("base64=1");
    expect(s).toContain(`serial=${Buffer.from("ABC123").toString("base64")}`);
    expect(formatSmbios1Param({ product: "NAB5", version: "OEM" })).toBe("product=NAB5,version=OEM");
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

  it("buildHostSmbiosProbeScript quotes case patterns containing spaces (valid bash)", () => {
    const script = buildHostSmbiosProbeScript();
    expect(script).toContain('*"Product Name:"*)');
    expect(script).toContain('*"Serial Number:"*)');
    expect(script).not.toMatch(/\*Product Name:\*\)/);
  });

  it("applyOemLicenseToVmConfig sets args through setArgs (root-only) and smbios via API", async () => {
    /** @type {string[]} */
    const setArgsCalls = [];
    const { applyOemLicenseToVmConfig } = await import(
      "hdc/clump/infrastructure/proxmox/lib/proxmox-oem-windows-apply.mjs"
    );
    await expect(
      applyOemLicenseToVmConfig({
        apiBase: "http://127.0.0.1:9/api2/json",
        node: "pve-a",
        vmid: 9001,
        authorization: "x",
        rejectUnauthorized: false,
        tablePaths: ["/etc/pve/nodes/pve-a/qemu-server/MSDM_table"],
        smbios: {},
        setArgs: async (a) => {
          setArgsCalls.push(a);
        },
      }),
    ).resolves.toBeUndefined();
    expect(setArgsCalls).toEqual(["-acpitable file=/etc/pve/nodes/pve-a/qemu-server/MSDM_table"]);
  });
});