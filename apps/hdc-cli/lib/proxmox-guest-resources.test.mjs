import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  applyLxcGuestResources,
  applyQemuGuestResources,
  guestResourceOptsFromBlock,
  noRebootFromFlags,
  parseGuestCpuType,
  parseGuestResourceSizing,
  rebootRequestedFromFlags,
  resolveRebootAfterResourceApply,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import * as lxcStart from "hdc/clump/infrastructure/proxmox/lib/proxmox-lxc-start.mjs";
import * as pveHttp from "hdc/clump/infrastructure/proxmox/lib/pve-http.mjs";

const apiOpts = {
  apiBase: "https://pve.test:8006",
  authorization: "PVEAPIToken=x",
  rejectUnauthorized: true,
  node: "hypervisor-a",
  vmid: 200,
  memoryMb: 4096,
  cores: 4,
};

describe("proxmox-guest-resources", () => {
  describe("parseGuestResourceSizing", () => {
    it("returns sizing when memory_mb and cores are valid", () => {
      expect(parseGuestResourceSizing({ memory_mb: 2048, cores: 2 })).toEqual({
        memoryMb: 2048,
        cores: 2,
      });
    });

    it("returns null when fields missing", () => {
      expect(parseGuestResourceSizing({ memory_mb: 2048 })).toBeNull();
      expect(parseGuestResourceSizing(null)).toBeNull();
    });
  });

  describe("parseGuestCpuType", () => {
    it("accepts host and rejects junk", () => {
      expect(parseGuestCpuType({ cpu: "host" })).toBe("host");
      expect(parseGuestCpuType({ cpu: "x86-64-v2" })).toBe("x86-64-v2");
      expect(parseGuestCpuType({ cpu: "not a type" })).toBeUndefined();
      expect(parseGuestCpuType({ memory_mb: 4096, cores: 4 })).toBeUndefined();
    });
  });

  describe("guestResourceOptsFromBlock", () => {
    it("includes reboot when flag set", () => {
      const opts = guestResourceOptsFromBlock({ memory_mb: 1024, cores: 1 }, { reboot: "1" });
      expect(opts).toEqual({ memoryMb: 1024, cores: 1, reboot: true });
    });

    it("includes cpu when qemu block sets it", () => {
      const opts = guestResourceOptsFromBlock(
        { memory_mb: 1024, cores: 1, cpu: "host" },
        {},
      );
      expect(opts?.cpu).toBe("host");
    });
  });

  describe("rebootRequestedFromFlags", () => {
    it("detects --reboot", () => {
      expect(rebootRequestedFromFlags({ reboot: "1" })).toBe(true);
      expect(rebootRequestedFromFlags({})).toBe(false);
    });
  });

  describe("applyQemuGuestResources", () => {
    beforeEach(() => {
      vi.spyOn(pveHttp, "pveJsonRequest");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("skips PUT when memory and cores already match", async () => {
      vi.mocked(pveHttp.pveJsonRequest).mockImplementation(async (method, _base, path) => {
        if (method === "GET" && path.endsWith("/config")) {
          return { data: { memory: 4096, cores: 4 } };
        }
        if (method === "GET" && path.endsWith("/status/current")) {
          return { data: { status: "stopped" } };
        }
        return {};
      });

      const result = await applyQemuGuestResources(apiOpts);
      expect(result.changed).toBe(false);
      expect(pveHttp.pveJsonRequest).not.toHaveBeenCalledWith("PUT", expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything());
    });

    it("PUTs memory and cores when different", async () => {
      vi.mocked(pveHttp.pveJsonRequest).mockImplementation(async (method, _base, path) => {
        if (method === "GET" && path.endsWith("/config")) {
          return { data: { memory: 2048, cores: 2 } };
        }
        if (method === "GET" && path.endsWith("/status/current")) {
          return { data: { status: "stopped" } };
        }
        return {};
      });

      const result = await applyQemuGuestResources(apiOpts);
      expect(result.changed).toBe(true);
      expect(pveHttp.pveJsonRequest).toHaveBeenCalledWith(
        "PUT",
        apiOpts.apiBase,
        "/nodes/hypervisor-a/qemu/200/config",
        apiOpts.authorization,
        true,
        expect.stringContaining("memory=4096"),
      );
    });

    it("PUTs cpu and stop/starts running guest when CPU type changes", async () => {
      vi.mocked(pveHttp.pveJsonRequest).mockImplementation(async (method, _base, path) => {
        if (method === "GET" && path.endsWith("/config")) {
          return { data: { memory: 4096, cores: 4 } };
        }
        if (method === "GET" && path.endsWith("/status/current")) {
          return { data: { status: "running" } };
        }
        if (method === "POST" && path.endsWith("/status/stop")) {
          return { data: "UPID:hypervisor-a:0003:stop" };
        }
        if (method === "POST" && path.endsWith("/status/start")) {
          return { data: "UPID:hypervisor-a:0004:start" };
        }
        return {};
      });
      vi.spyOn(pveHttp, "waitForPveTask").mockResolvedValue(undefined);

      const result = await applyQemuGuestResources({
        ...apiOpts,
        cpu: "host",
        rebootOnChange: true,
      });
      expect(result.changed).toBe(true);
      expect(pveHttp.pveJsonRequest).toHaveBeenCalledWith(
        "PUT",
        apiOpts.apiBase,
        "/nodes/hypervisor-a/qemu/200/config",
        apiOpts.authorization,
        true,
        expect.stringContaining("cpu=host"),
      );
      expect(pveHttp.pveJsonRequest).toHaveBeenCalledWith(
        "POST",
        apiOpts.apiBase,
        "/nodes/hypervisor-a/qemu/200/status/stop",
        apiOpts.authorization,
        true,
        expect.anything(),
      );
      expect(pveHttp.pveJsonRequest).toHaveBeenCalledWith(
        "POST",
        apiOpts.apiBase,
        "/nodes/hypervisor-a/qemu/200/status/start",
        apiOpts.authorization,
        true,
        expect.anything(),
      );
    });

    it("reboots running guest when rebootOnChange and sizing changed", async () => {
      vi.mocked(pveHttp.pveJsonRequest).mockImplementation(async (method, _base, path) => {
        if (method === "GET" && path.endsWith("/config")) {
          return { data: { memory: 2048, cores: 2 } };
        }
        if (method === "GET" && path.endsWith("/status/current")) {
          return { data: { status: "running" } };
        }
        if (method === "POST" && path.endsWith("/status/reboot")) {
          return { data: "UPID:hypervisor-a:0002:reboot" };
        }
        return {};
      });
      vi.spyOn(pveHttp, "waitForPveTask").mockResolvedValue(undefined);

      await applyQemuGuestResources({ ...apiOpts, rebootOnChange: true });
      expect(pveHttp.pveJsonRequest).toHaveBeenCalledWith(
        "POST",
        apiOpts.apiBase,
        "/nodes/hypervisor-a/qemu/200/status/reboot",
        apiOpts.authorization,
        true,
        expect.anything(),
      );
    });
  });

  describe("resolveRebootAfterResourceApply", () => {
    it("honors --no-reboot over rebootOnChange", () => {
      expect(resolveRebootAfterResourceApply({ "no-reboot": "1" }, true)).toBe(false);
      expect(noRebootFromFlags({ "no-reboot": "1" })).toBe(true);
    });

    it("reboots on change when not disabled", () => {
      expect(resolveRebootAfterResourceApply({}, true)).toBe(true);
      expect(resolveRebootAfterResourceApply({ reboot: "1" }, false)).toBe(true);
    });
  });

  describe("applyLxcGuestResources", () => {
    beforeEach(() => {
      vi.spyOn(pveHttp, "pveJsonRequest");
      vi.spyOn(lxcStart, "getLxcRuntimeStatus");
      vi.spyOn(lxcStart, "startLxc").mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("stops running CT before PUT when sizing changes", async () => {
      vi.mocked(lxcStart.getLxcRuntimeStatus)
        .mockResolvedValueOnce("running")
        .mockResolvedValueOnce("stopped")
        .mockResolvedValueOnce("running");
      vi.mocked(pveHttp.pveJsonRequest).mockImplementation(async (method, _base, path) => {
        if (method === "GET" && path.endsWith("/config")) {
          return { data: { memory: 512, cores: 1 } };
        }
        if (method === "POST" && path.endsWith("/status/stop")) {
          return { data: "UPID:hypervisor-a:0001:stop" };
        }
        return {};
      });
      vi.spyOn(pveHttp, "waitForPveTask").mockResolvedValue(undefined);

      const result = await applyLxcGuestResources(apiOpts);
      expect(result.changed).toBe(true);
      expect(pveHttp.pveJsonRequest).toHaveBeenCalledWith(
        "POST",
        apiOpts.apiBase,
        "/nodes/hypervisor-a/lxc/200/status/stop",
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(lxcStart.startLxc).toHaveBeenCalled();
    });
  });
});
