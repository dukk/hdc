import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  applyGuestBootOptions,
  formatProxmoxStartupString,
  parseGuestBootOptions,
  parseProxmoxStartupString,
  startupSpecsEqual,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-guest-startup.mjs";
import {
  collectStartupTargetsFromPackages,
  deploymentStartupRow,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-guest-startup-maintain.mjs";
import * as pveHttp from "hdc/clump/infrastructure/proxmox/lib/pve-http.mjs";
import * as guestResources from "hdc/clump/infrastructure/proxmox/lib/proxmox-guest-resources.mjs";

const apiOpts = {
  guestType: /** @type {const} */ ("qemu"),
  apiBase: "https://pve.test:8006",
  authorization: "PVEAPIToken=x",
  rejectUnauthorized: true,
  node: "hypervisor-a",
  vmid: 200,
  boot: { onboot: 1, startup: { order: 1, up: 30 } },
};

const proxmoxCfg = {
  schema_version: 1,
  clusters: [{ id: "c", hosts: [{ id: "hypervisor-a", pve_node: "hypervisor-a", ip: "192.0.2.1", web_ui: "https://192.0.2.1:8006", ssh: "ssh://root@192.0.2.1" }] }],
  provision: {
    startup: {
      enabled: true,
      default_up: 30,
      priorities: {
        bind: 1,
        "nginx-waf": 2,
        "postfix-relay": 3,
      },
    },
  },
};

describe("proxmox-guest-startup", () => {
  describe("formatProxmoxStartupString", () => {
    it("builds order and up", () => {
      expect(formatProxmoxStartupString({ order: 2, up: 30 })).toBe("order=2,up=30");
    });
  });

  describe("parseProxmoxStartupString", () => {
    it("parses live startup string", () => {
      expect(parseProxmoxStartupString("order=3,up=30")).toEqual({ order: 3, up: 30 });
    });
  });

  describe("startupSpecsEqual", () => {
    it("compares order and up", () => {
      expect(startupSpecsEqual({ order: 1, up: 30 }, { order: 1, up: 30 })).toBe(true);
      expect(startupSpecsEqual({ order: 1, up: 30 }, { order: 2, up: 30 })).toBe(false);
    });
  });

  describe("parseGuestBootOptions", () => {
    it("uses explicit startup on block", () => {
      expect(parseGuestBootOptions({ onboot: 1, startup: { order: 2 } }, proxmoxCfg)).toEqual({
        onboot: 1,
        startup: { order: 2, up: 30 },
      });
    });

    it("falls back to package priority map", () => {
      expect(parseGuestBootOptions({ onboot: 1 }, proxmoxCfg, "bind")).toEqual({
        onboot: 1,
        startup: { order: 1, up: 30 },
      });
    });

    it("returns null when no startup configured", () => {
      expect(parseGuestBootOptions({}, proxmoxCfg, "pi-hole")).toBeNull();
    });
  });

  describe("deploymentStartupRow", () => {
    it("resolves bind deployment from defaults", () => {
      const row = deploymentStartupRow(
        {
          system_id: "vm-bind-a",
          mode: "proxmox-qemu",
          hostname: "bind-a",
          proxmox: { host_id: "hypervisor-b", qemu: { ip: "192.0.2.2/24" } },
        },
        {
          mode: "proxmox-qemu",
          proxmox: {
            qemu: { onboot: 1, startup: { order: 1 } },
          },
        },
        "bind",
        proxmoxCfg,
      );
      expect(row?.guestType).toBe("qemu");
      expect(row?.boot.startup).toEqual({ order: 1, up: 30 });
    });
  });

  describe("applyGuestBootOptions", () => {
    beforeEach(() => {
      vi.spyOn(pveHttp, "pveJsonRequest");
      vi.spyOn(guestResources, "getQemuConfig");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("skips PUT when live config matches", async () => {
      vi.mocked(guestResources.getQemuConfig).mockResolvedValue({
        onboot: 1,
        startup: "order=1,up=30",
      });

      const result = await applyGuestBootOptions(apiOpts);
      expect(result.changed).toBe(false);
      expect(pveHttp.pveJsonRequest).not.toHaveBeenCalledWith(
        "PUT",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it("PUTs when startup order drifts", async () => {
      vi.mocked(guestResources.getQemuConfig).mockResolvedValue({
        onboot: 1,
        startup: "order=9,up=30",
      });
      vi.mocked(pveHttp.pveJsonRequest).mockResolvedValue({});

      const result = await applyGuestBootOptions(apiOpts);
      expect(result.changed).toBe(true);
      expect(pveHttp.pveJsonRequest).toHaveBeenCalledWith(
        "PUT",
        apiOpts.apiBase,
        expect.stringContaining("/qemu/200/config"),
        apiOpts.authorization,
        apiOpts.rejectUnauthorized,
        expect.anything(),
      );
    });
  });

  describe("collectStartupTargetsFromPackages", () => {
    it("includes priority packages from public examples", () => {
      const targets = collectStartupTargetsFromPackages(process.cwd(), proxmoxCfg);
      const packages = new Set(targets.map((t) => t.clumpId));
      expect(packages.has("bind")).toBe(true);
      expect(packages.has("postfix-relay")).toBe(true);
    });
  });
});
