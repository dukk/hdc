import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  formatProxmoxTags,
  mergePackageTag,
  mergeBackupFrequencyTag,
  backupFrequencyTagForProfile,
  normalizePackageTag,
  parseProxmoxTags,
  proxmoxGuestTypeFromMode,
  ensureGuestPackageTag,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-guest-tags.mjs";
import {
  collectTagTargetsFromPackages,
  deploymentTagRow,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-guest-tags-maintain.mjs";
import * as pveHttp from "../../../clumps/infrastructure/proxmox/lib/pve-http.mjs";
import * as guestResources from "../../../clumps/infrastructure/proxmox/lib/proxmox-guest-resources.mjs";

describe("proxmox-guest-tags", () => {
  describe("normalizePackageTag", () => {
    it("accepts service manifest ids", () => {
      expect(normalizePackageTag("pi-hole")).toBe("pi-hole");
      expect(normalizePackageTag("nginx-waf")).toBe("nginx-waf");
      expect(normalizePackageTag("n8n")).toBe("n8n");
    });

    it("rejects invalid tags", () => {
      expect(normalizePackageTag("")).toBeNull();
      expect(normalizePackageTag("  ")).toBeNull();
      expect(normalizePackageTag("Bad_Case")).toBeNull();
    });
  });

  describe("parseProxmoxTags / formatProxmoxTags", () => {
    it("parses semicolon and comma separated tags", () => {
      expect(parseProxmoxTags("pi-hole;ops,pi-hole")).toEqual(["pi-hole", "ops"]);
    });

    it("formats unique lowercase tags", () => {
      expect(formatProxmoxTags(["pi-hole", "ops", "pi-hole"])).toBe("pi-hole;ops");
    });
  });

  describe("mergePackageTag", () => {
    it("adds package tag when missing", () => {
      expect(mergePackageTag("ops", "pi-hole")).toEqual({
        tags: ["ops", "pi-hole"],
        changed: true,
      });
    });

    it("is a no-op when tag already present", () => {
      expect(mergePackageTag("pi-hole;ops", "pi-hole")).toEqual({
        tags: ["pi-hole", "ops"],
        changed: false,
      });
    });
  });

  describe("mergeBackupFrequencyTag", () => {
    it("maps profiles to tags", () => {
      expect(backupFrequencyTagForProfile("twice-weekly")).toBe("backup-twice-weekly");
    });

    it("replaces other frequency tags", () => {
      expect(mergeBackupFrequencyTag("bind;backup-weekly", "daily")).toEqual({
        tags: ["bind", "backup-daily"],
        changed: true,
        desiredTag: "backup-daily",
      });
    });

    it("is a no-op when frequency tag already correct", () => {
      expect(mergeBackupFrequencyTag("bind;backup-daily", "daily").changed).toBe(false);
    });
  });

  describe("proxmoxGuestTypeFromMode", () => {
    it("maps proxmox deployment modes", () => {
      expect(proxmoxGuestTypeFromMode("proxmox-lxc")).toBe("lxc");
      expect(proxmoxGuestTypeFromMode("proxmox-qemu")).toBe("qemu");
      expect(proxmoxGuestTypeFromMode("proxmox-qemu-clone")).toBe("qemu");
      expect(proxmoxGuestTypeFromMode("proxmox-qemu-haos")).toBe("qemu");
      expect(proxmoxGuestTypeFromMode("ubuntu-docker")).toBeNull();
    });
  });

  describe("deploymentTagRow", () => {
    it("collects proxmox guests without startup config", () => {
      const row = deploymentTagRow(
        {
          system_id: "pi-hole-a",
          mode: "proxmox-lxc",
          proxmox: {
            host_id: "hypervisor-a",
            lxc: { vmid: 101, hostname: "pi-hole-a" },
          },
        },
        null,
        "pi-hole",
      );
      expect(row).toEqual({
        systemId: "pi-hole-a",
        hostId: "hypervisor-a",
        guestType: "lxc",
        vmid: 101,
        lookupName: "pi-hole-a",
      });
    });
  });

  describe("ensureGuestPackageTag", () => {
    beforeEach(() => {
      vi.spyOn(guestResources, "getLxcConfig").mockResolvedValue({ tags: "ops" });
      vi.spyOn(pveHttp, "pveJsonRequest").mockResolvedValue({});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("PUTs when package tag is missing", async () => {
      const result = await ensureGuestPackageTag({
        guestType: "lxc",
        apiBase: "https://pve.test:8006",
        authorization: "PVEAPIToken=x",
        rejectUnauthorized: true,
        node: "hypervisor-a",
        vmid: 101,
        clumpId: "pi-hole",
        log: () => {},
      });
      expect(result.changed).toBe(true);
      expect(pveHttp.pveJsonRequest).toHaveBeenCalledWith(
        "PUT",
        "https://pve.test:8006",
        "/nodes/hypervisor-a/lxc/101/config",
        "PVEAPIToken=x",
        true,
        expect.stringContaining("tags=ops%3Bpi-hole"),
      );
    });

    it("skips PUT when tag already present", async () => {
      vi.spyOn(guestResources, "getLxcConfig").mockResolvedValue({ tags: "pi-hole;ops" });
      const result = await ensureGuestPackageTag({
        guestType: "lxc",
        apiBase: "https://pve.test:8006",
        authorization: "PVEAPIToken=x",
        rejectUnauthorized: true,
        node: "hypervisor-a",
        vmid: 101,
        clumpId: "pi-hole",
        log: () => {},
      });
      expect(result.changed).toBe(false);
      expect(pveHttp.pveJsonRequest).not.toHaveBeenCalled();
    });
  });

  describe("collectTagTargetsFromPackages", () => {
    it("returns empty when services dir missing", () => {
      expect(collectTagTargetsFromPackages("/nonexistent-root")).toEqual([]);
    });
  });
});
