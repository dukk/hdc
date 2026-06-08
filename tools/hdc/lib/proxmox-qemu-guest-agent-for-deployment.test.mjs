import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  guestHostnameForDeployment,
  locateQemuGuestByName,
  resolveQemuGuestPlacement,
  sshTargetForGuestAgentDeployment,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-qemu-guest-agent-for-deployment.mjs";
import * as hostProvisioner from "../../../packages/infrastructure/proxmox/lib/proxmox-host-provisioner.mjs";

describe("proxmox-qemu-guest-agent-for-deployment", () => {
  describe("guestHostnameForDeployment", () => {
    it("prefers deployment.hostname", () => {
      expect(
        guestHostnameForDeployment({
          systemId: "vm-bind-a",
          hostname: "bind-a",
        }),
      ).toBe("bind-a");
    });

    it("falls back to systemId without vm- prefix", () => {
      expect(guestHostnameForDeployment({ systemId: "vm-bind-b" })).toBe("bind-b");
    });
  });

  describe("sshTargetForGuestAgentDeployment", () => {
    it("uses configure.ssh when set (legacy root maps to hdc)", () => {
      expect(
        sshTargetForGuestAgentDeployment(
          {
            systemId: "vm-bind-a",
            configure: { ssh: { user: "root", host: "10.0.0.2" } },
          },
          "192.0.2.2",
        ),
      ).toEqual({ user: "hdc", host: "10.0.0.2" });
    });

    it("falls back to defaultSshHost", () => {
      expect(
        sshTargetForGuestAgentDeployment({ systemId: "vm-bind-a", configure: {} }, "192.0.2.2"),
      ).toEqual({ user: "hdc", host: "192.0.2.2" });
    });
  });

  describe("locateQemuGuestByName", () => {
    it("finds guest by case-insensitive name", () => {
      const resources = [
        { type: "qemu", vmid: 200, name: "bind-a", node: "hypervisor-b", template: 0 },
        { type: "qemu", vmid: 201, name: "bind-b", node: "hypervisor-c", template: 0 },
      ];
      const found = locateQemuGuestByName(resources, "Bind-A");
      expect(found).toEqual({ vmid: 200, node: "hypervisor-b", name: "bind-a" });
    });
  });

  describe("resolveQemuGuestPlacement", () => {
    beforeEach(() => {
      vi.spyOn(hostProvisioner, "fetchClusterVmResources").mockResolvedValue([
        { type: "qemu", vmid: 300, name: "nginx-waf-a", node: "hypervisor-a", template: 0 },
        { type: "qemu", vmid: 201, name: "bind-a", node: "hypervisor-b", template: 0 },
      ]);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("resolves by vmid when configured", async () => {
      const placement = await resolveQemuGuestPlacement(
        "https://pve.test:8006",
        "PVEAPIToken=x",
        true,
        {
          systemId: "vm-nginx-waf-a",
          proxmox: { host_id: "hypervisor-a", qemu: { vmid: 300 } },
        },
      );
      expect(placement).toEqual({ vmid: 300, node: "hypervisor-a" });
    });

    it("resolves by hostname when vmid omitted", async () => {
      const placement = await resolveQemuGuestPlacement(
        "https://pve.test:8006",
        "PVEAPIToken=x",
        true,
        {
          systemId: "vm-bind-a",
          hostname: "bind-a",
          proxmox: { host_id: "hypervisor-b" },
        },
      );
      expect(placement).toEqual({ vmid: 201, node: "hypervisor-b" });
    });

    it("returns null when guest not found", async () => {
      const placement = await resolveQemuGuestPlacement(
        "https://pve.test:8006",
        "PVEAPIToken=x",
        true,
        {
          systemId: "vm-bind-z",
          hostname: "missing",
          proxmox: { host_id: "hypervisor-b" },
        },
      );
      expect(placement).toBeNull();
    });
  });
});
