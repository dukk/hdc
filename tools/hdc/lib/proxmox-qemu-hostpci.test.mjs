import { describe, expect, it } from "vitest";
import {
  formatHostpciEntry,
  normalizeHostpciList,
  validatePciBdf,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-qemu-hostpci.mjs";

describe("proxmox-qemu-hostpci", () => {
  it("formatHostpciEntry builds Proxmox hostpci string", () => {
    expect(
      formatHostpciEntry({ id: "0000:03:00.0", pcie: true, rombar: false }),
    ).toBe("0000:03:00.0,pcie=1,rombar=0");
  });

  it("validatePciBdf rejects invalid ids", () => {
    expect(() => validatePciBdf("03:00.0")).toThrow(/0000:bb:dd/);
  });

  it("normalizeHostpciList requires id on each entry", () => {
    expect(() => normalizeHostpciList([{ pcie: true }])).toThrow(/id required/);
    const list = normalizeHostpciList([{ id: "0000:01:00.0", pcie: true }]);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("0000:01:00.0");
  });
});
