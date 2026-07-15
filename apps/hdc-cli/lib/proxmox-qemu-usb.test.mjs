import { describe, expect, it } from "vitest";
import {
  formatUsbEntry,
  normalizeUsbList,
  validateUsbVendorProduct,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-qemu-usb.mjs";

describe("proxmox-qemu-usb", () => {
  it("formatUsbEntry builds Proxmox usb string", () => {
    expect(formatUsbEntry({ id: "1a86:55d4" })).toBe("host=1a86:55d4");
    expect(formatUsbEntry({ id: "10c4:ea60", usb3: true })).toBe("host=10c4:ea60,usb3=1");
  });

  it("validateUsbVendorProduct rejects invalid ids", () => {
    expect(() => validateUsbVendorProduct("1a86-55d4")).toThrow(/vvvv:pppp/);
    expect(() => validateUsbVendorProduct("abc")).toThrow(/vvvv:pppp/);
  });

  it("normalizeUsbList requires id on each entry", () => {
    expect(() => normalizeUsbList([{ usb3: true }])).toThrow(/id required/);
    const list = normalizeUsbList([{ id: "1a86:55d4" }]);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("1a86:55d4");
  });
});
