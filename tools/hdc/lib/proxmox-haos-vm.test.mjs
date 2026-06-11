import { describe, expect, it } from "vitest";

import {
  haosConsoleNeedsRepair,
  haosEfiSecureBootNeedsRepair,
  haosEfidisk0Spec,
  resolveHaosImportedDiskVolume,
} from "../../../packages/services/homeassistant/lib/proxmox-haos-vm.mjs";

describe("resolveHaosImportedDiskVolume", () => {
  it("prefers unused0 after importdisk", () => {
    const vol = resolveHaosImportedDiskVolume(
      {
        efidisk0: "local-lvm:vm-121-disk-0,efitype=4m,size=4M",
        unused0: "local-lvm:vm-121-disk-1",
      },
      "local-lvm",
      121,
    );
    expect(vol).toBe("local-lvm:vm-121-disk-1");
  });

  it("detects scsi0 wrongly attached to the EFI disk", () => {
    const vol = resolveHaosImportedDiskVolume(
      {
        efidisk0: "local-lvm:vm-121-disk-0,efitype=4m,size=4M",
        scsi0: "local-lvm:vm-121-disk-0,discard=on",
      },
      "local-lvm",
      121,
    );
    expect(vol).toBe("local-lvm:vm-121-disk-1");
  });

  it("haosEfiSecureBootNeedsRepair detects pre-enrolled-keys=1", () => {
    expect(
      haosEfiSecureBootNeedsRepair({
        efidisk0: "local-lvm:vm-121-disk-0,efitype=4m,pre-enrolled-keys=1,size=4M",
      }),
    ).toBe(true);
    expect(
      haosEfiSecureBootNeedsRepair({
        efidisk0: "local-lvm:vm-121-disk-2,efitype=4m,pre-enrolled-keys=0,size=4M",
      }),
    ).toBe(false);
    expect(haosEfidisk0Spec("local-lvm")).toContain("pre-enrolled-keys=0");
  });

  it("haosConsoleNeedsRepair detects serial console misconfig", () => {
    expect(haosConsoleNeedsRepair({ vga: "serial0" })).toBe(true);
    expect(haosConsoleNeedsRepair({ serial0: "socket" })).toBe(true);
    expect(haosConsoleNeedsRepair({ vga: "serial0", serial0: "socket" })).toBe(true);
    expect(haosConsoleNeedsRepair({ vga: "std" })).toBe(false);
    expect(haosConsoleNeedsRepair({ vga: "std", tablet: 0 })).toBe(false);
  });

  it("throws when no imported disk is present", () => {
    expect(() =>
      resolveHaosImportedDiskVolume(
        { efidisk0: "local-lvm:vm-121-disk-0,efitype=4m,size=4M" },
        "local-lvm",
        121,
      ),
    ).toThrow(/No imported HAOS disk/);
  });
});
