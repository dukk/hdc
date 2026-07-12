import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  proxmoxGuestTypeFromMode,
  syncProxmoxGuestResourcesOnMaintain,
} from "../../../clumps/lib/proxmox-guest-resources-maintain.mjs";
import * as deployAuth from "../../../clumps/infrastructure/proxmox/lib/proxmox-deploy-auth.mjs";
import * as guestResources from "../../../clumps/infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import * as hostProvisioner from "../../../clumps/infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";

describe("proxmox-guest-resources-maintain", () => {
  describe("proxmoxGuestTypeFromMode", () => {
    it("maps proxmox modes", () => {
      expect(proxmoxGuestTypeFromMode("proxmox-lxc")).toBe("lxc");
      expect(proxmoxGuestTypeFromMode("proxmox-qemu")).toBe("qemu");
      expect(proxmoxGuestTypeFromMode("configure-only")).toBeNull();
    });
  });

  describe("syncProxmoxGuestResourcesOnMaintain", () => {
    beforeEach(() => {
      vi.spyOn(deployAuth, "authorizeProxmoxForHost").mockResolvedValue({
        host: {
          apiBase: "https://pve.test:8006",
          pveNode: "hypervisor-a",
        },
        authorization: "PVEAPIToken=x",
        rejectUnauthorized: true,
      });
      vi.spyOn(hostProvisioner, "fetchClusterVmResources").mockResolvedValue([]);
      vi.spyOn(hostProvisioner, "locateVmidInCluster").mockReturnValue({
        node: "hypervisor-b",
        type: "qemu",
      });
      vi.spyOn(guestResources, "applyQemuGuestResources").mockResolvedValue({
        ok: true,
        changed: true,
        previous: { memory: 2048, cores: 2 },
        applied: { memory: 4096, cores: 4 },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("skips when --skip-resources", async () => {
      const result = await syncProxmoxGuestResourcesOnMaintain({
        deployment: {
          mode: "proxmox-qemu",
          proxmox: {
            host_id: "hypervisor-a",
            qemu: { vmid: 200, memory_mb: 4096, cores: 4 },
          },
        },
        proxmoxPackageRoot: "/fake/proxmox",
        flags: { "skip-resources": "1" },
      });
      expect(result.skipped).toBe(true);
      expect(deployAuth.authorizeProxmoxForHost).not.toHaveBeenCalled();
    });

    it("applies QEMU resources with rebootOnChange on maintain", async () => {
      const result = await syncProxmoxGuestResourcesOnMaintain({
        deployment: {
          mode: "proxmox-qemu",
          proxmox: {
            host_id: "hypervisor-a",
            qemu: { vmid: 200, memory_mb: 4096, cores: 4 },
          },
        },
        proxmoxPackageRoot: "/fake/proxmox",
        flags: {},
      });
      expect(result.ok).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.node).toBe("hypervisor-b");
      expect(guestResources.applyQemuGuestResources).toHaveBeenCalledWith(
        expect.objectContaining({
          vmid: 200,
          memoryMb: 4096,
          cores: 4,
          rebootOnChange: true,
          node: "hypervisor-b",
        }),
      );
    });

    it("dry-run logs intent without API writes", async () => {
      const lines = [];
      const result = await syncProxmoxGuestResourcesOnMaintain({
        deployment: {
          mode: "proxmox-lxc",
          proxmox: {
            host_id: "hypervisor-a",
            lxc: { vmid: 100, memory_mb: 512, cores: 1 },
          },
        },
        proxmoxPackageRoot: "/fake/proxmox",
        flags: { "dry-run": "1" },
        log: (line) => lines.push(line),
      });
      expect(result.dry_run).toBe(true);
      expect(lines.some((l) => l.includes("memory=512"))).toBe(true);
      expect(deployAuth.authorizeProxmoxForHost).not.toHaveBeenCalled();
    });
  });
});
