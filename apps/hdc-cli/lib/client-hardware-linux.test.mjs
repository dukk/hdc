import { describe, expect, it } from "vitest";
import { hardwareCommand, parseHardwareOutput } from "hdc/clump/services/meshcentral/lib/meshcentral-ops.mjs";

describe("linux hardwareCommand (Raspberry Pi device-tree)", () => {
  it("includes device-tree model fallback in the python collector", () => {
    const cmd = hardwareCommand("linux");
    expect(cmd).toContain("/proc/device-tree/model");
    expect(cmd).toContain("Raspberry Pi");
  });

  it("parses Pi-like JSON from the collector shape", () => {
    const parsed = parseHardwareOutput(
      JSON.stringify({
        manufacturer: "Raspberry Pi",
        model: "Raspberry Pi 4 Model B Rev 1.5",
        serial: "",
        cpu_model: "BCM2711",
        logical_cores: 4,
        memory_gb: 3.7,
        mac: "dc:a6:32:00:11:22",
        disks: [{ device: "/", size_gb: 29.1, free_gb: 12.4 }],
        gpus: [],
        oem_firmware_msdm: false,
        oem_firmware_slic: false,
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.mac).toBe("dc:a6:32:00:11:22");
    expect(parsed.hardware).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "system",
          manufacturer: "Raspberry Pi",
          model: "Raspberry Pi 4 Model B Rev 1.5",
        }),
        expect.objectContaining({ type: "cpu", model: "BCM2711", logical_cores: 4 }),
        expect.objectContaining({ type: "memory", total_gb: 3.7 }),
      ]),
    );
  });
});
