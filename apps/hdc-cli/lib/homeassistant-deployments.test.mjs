import { describe, expect, it } from "vitest";
import {
  expandDeployment,
  normalizeHomeassistantConfig,
  resolveHomeassistantDeployments,
} from "hdc/clump/services/homeassistant/lib/deployments.mjs";
import { haosOvaDownloadUrl } from "hdc/clump/services/homeassistant/lib/haos-image.mjs";
import {
  filterCoordinatorCandidates,
  parseLsusbOutput,
} from "hdc/clump/services/homeassistant/lib/usb-preflight.mjs";

describe("homeassistant deployments", () => {
  const sample = {
    schema_version: 2,
    homeassistant: { release: "16.0" },
    defaults: {
      mode: "proxmox-qemu-haos",
      proxmox: {
        network: { gateway: "192.0.2.1", dns: ["192.0.2.2"] },
        qemu: { storage: "local-lvm", cores: 2, memory_mb: 4096, rootfs_gb: 32 },
      },
    },
    deployments: [
      {
        system_id: "vm-homeassistant-a",
        hostname: "ha",
        homeassistant: { release: "16.0", public_url: "https://ha.example.invalid" },
        proxmox: {
          host_id: "pve-h",
          qemu: { vmid: 120, ip: "192.0.2.30/24", usb: [{ id: "1a86:55d4" }] },
        },
      },
    ],
  };

  it("normalizeHomeassistantConfig validates system_id", () => {
    const norm = normalizeHomeassistantConfig(sample);
    expect(norm.deployments).toHaveLength(1);
    const expanded = expandDeployment(norm.deployments[0], norm);
    expect(expanded.systemId).toBe("vm-homeassistant-a");
    expect(expanded.proxmox.qemu.usb[0].id).toBe("1a86:55d4");
  });

  it("resolveHomeassistantDeployments filters by instance", () => {
    const one = resolveHomeassistantDeployments(sample, { instance: "a" });
    expect(one).toHaveLength(1);
    expect(one[0].hostname).toBe("ha");
  });

  it("haosOvaDownloadUrl builds GitHub release URL", () => {
    expect(haosOvaDownloadUrl("16.0")).toContain("home-assistant/operating-system");
    expect(haosOvaDownloadUrl("16.0")).toContain("haos_ova-16.0.qcow2.xz");
  });
});

describe("usb-preflight", () => {
  it("parseLsusbOutput extracts vendor:product", () => {
    const out = parseLsusbOutput(
      "Bus 001 Device 004: ID 1a86:55d4 QinHeng Electronics Zigbee\n" +
        "Bus 001 Device 002: ID 1d6b:0002 Linux Foundation 2.0 root hub",
    );
    expect(out).toHaveLength(2);
    const candidates = filterCoordinatorCandidates(out);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("1a86:55d4");
  });
});
