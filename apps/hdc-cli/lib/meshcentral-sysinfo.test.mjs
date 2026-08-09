import { describe, expect, it } from "vitest";
import { parseMeshSysinfoHardware } from "hdc/clump/services/meshcentral/lib/meshcentral-ops.mjs";

describe("parseMeshSysinfoHardware", () => {
  it("maps identifiers + memory slots to inventory hardware[]", () => {
    const parsed = parseMeshSysinfoHardware({
      hardware: {
        identifiers: {
          chassis_manufacturer: "Gigabyte Technology Co., Ltd.",
          product_name: "B660 DS3H AC DDR4-Y1",
          bios_serial: "Default string",
          cpu_name: "12th Gen Intel(R) Core(TM) i3-12100F",
          gpu_name: ["Meta Virtual Monitor", "AMD Radeon RX 6500 XT"],
          storage_devices: [{ Caption: "Samsung SSD", Size: 500107862016 }],
        },
        windows: {
          memory: [{ Capacity: 8589934592 }, { Capacity: 8589934592 }],
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.hardware).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "system",
          manufacturer: "Gigabyte Technology Co., Ltd.",
          model: "B660 DS3H AC DDR4-Y1",
        }),
        expect.objectContaining({ type: "cpu", model: "12th Gen Intel(R) Core(TM) i3-12100F" }),
        expect.objectContaining({ type: "memory", total_gb: 16 }),
        expect.objectContaining({ type: "gpu", model: "AMD Radeon RX 6500 XT" }),
        expect.objectContaining({ type: "disk", device: "Samsung SSD", size_gb: expect.any(Number) }),
      ]),
    );
    expect(parsed.hardware.filter((h) => h.type === "gpu")).toHaveLength(1);
    expect(parsed.hardware.find((h) => h.type === "system")?.serial).toBeUndefined();
  });

  it("returns ok:false when hardware missing", () => {
    expect(parseMeshSysinfoHardware({ result: "no device" }).ok).toBe(false);
    expect(parseMeshSysinfoHardware(null).ok).toBe(false);
  });
});
