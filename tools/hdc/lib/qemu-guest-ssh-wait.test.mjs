import { describe, expect, it, vi, beforeEach } from "vitest";
import * as guestResources from "../../../packages/infrastructure/proxmox/lib/proxmox-guest-resources.mjs";
import * as sshWait from "../../../packages/lib/ssh-wait.mjs";
import {
  resolveQemuFirstBootWaitTiming,
  waitForQemuGuestSshAfterBoot,
} from "../../../packages/lib/qemu-guest-ssh-wait.mjs";

describe("qemu-guest-ssh-wait", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveQemuFirstBootWaitTiming", () => {
    it("uses defaults for fresh clone", () => {
      const t = resolveQemuFirstBootWaitTiming({ freshClone: true });
      expect(t.settleMs).toBe(45_000);
      expect(t.sshProbeMs).toBe(90_000);
      expect(t.rebootOnProbeFail).toBe(true);
      expect(t.alwaysReboot).toBe(false);
    });

    it("skips settle delay after maintain reboot", () => {
      const t = resolveQemuFirstBootWaitTiming({ freshClone: false });
      expect(t.settleMs).toBe(0);
    });

    it("reads provision.qemu.first_boot from config", () => {
      const t = resolveQemuFirstBootWaitTiming({
        freshClone: true,
        proxmoxCfg: {
          provision: {
            qemu: {
              first_boot: {
                settle_seconds: 10,
                ssh_probe_seconds: 30,
                ssh_timeout_seconds: 120,
                reboot_on_probe_fail: false,
              },
            },
          },
        },
      });
      expect(t.settleMs).toBe(10_000);
      expect(t.sshProbeMs).toBe(30_000);
      expect(t.sshTimeoutMs).toBe(120_000);
      expect(t.rebootOnProbeFail).toBe(false);
    });

    it("honors --skip-first-boot-reboot", () => {
      const t = resolveQemuFirstBootWaitTiming({
        flags: { "skip-first-boot-reboot": "1" },
      });
      expect(t.rebootOnProbeFail).toBe(false);
      expect(t.alwaysReboot).toBe(false);
    });

    it("honors --first-boot-reboot", () => {
      const t = resolveQemuFirstBootWaitTiming({
        flags: { "first-boot-reboot": "1" },
      });
      expect(t.alwaysReboot).toBe(true);
    });
  });

  describe("waitForQemuGuestSshAfterBoot", () => {
    const apiOpts = {
      user: "hdc",
      host: "10.0.0.1",
      apiBase: "https://pve.test:8006",
      node: "hypervisor-a",
      vmid: 200,
      authorization: "PVEAPIToken=x",
      rejectUnauthorized: true,
      freshClone: false,
      flags: { "skip-first-boot-reboot": "1" },
      log: () => {},
    };

    it("returns when SSH probe succeeds without reboot", async () => {
      vi.spyOn(sshWait, "waitForSsh").mockResolvedValue(undefined);
      const rebootSpy = vi.spyOn(guestResources, "rebootQemuGuest");

      const result = await waitForQemuGuestSshAfterBoot(apiOpts);
      expect(result).toEqual({ user: "hdc" });
      expect(rebootSpy).not.toHaveBeenCalled();
      expect(sshWait.waitForSsh).toHaveBeenCalledTimes(1);
    });

    it("reboots and retries SSH when probe fails", async () => {
      vi.spyOn(sshWait, "waitForSsh")
        .mockRejectedValueOnce(new Error("hdc probe timeout"))
        .mockRejectedValueOnce(new Error("root probe timeout"))
        .mockResolvedValueOnce(undefined);
      const rebootSpy = vi.spyOn(guestResources, "rebootQemuGuest").mockResolvedValue(undefined);

      const result = await waitForQemuGuestSshAfterBoot({
        ...apiOpts,
        flags: {},
        freshClone: false,
      });

      expect(result).toEqual({ user: "hdc" });
      expect(rebootSpy).toHaveBeenCalledTimes(1);
      expect(sshWait.waitForSsh).toHaveBeenCalledTimes(3);
    });

    it("throws after probe fail when reboot disabled", async () => {
      vi.spyOn(sshWait, "waitForSsh").mockRejectedValue(new Error("probe timeout"));
      vi.spyOn(guestResources, "rebootQemuGuest");

      await expect(waitForQemuGuestSshAfterBoot(apiOpts)).rejects.toThrow("probe timeout");
      expect(guestResources.rebootQemuGuest).not.toHaveBeenCalled();
    });

    it("falls back to root when primary user probe fails then succeeds as root", async () => {
      vi.spyOn(sshWait, "waitForSsh")
        .mockRejectedValueOnce(new Error("hdc fail"))
        .mockResolvedValueOnce(undefined);
      vi.spyOn(guestResources, "rebootQemuGuest");

      const result = await waitForQemuGuestSshAfterBoot({
        ...apiOpts,
        flags: { "skip-first-boot-reboot": "1" },
      });
      expect(result).toEqual({ user: "root" });
      expect(sshWait.waitForSsh).toHaveBeenCalledTimes(2);
    });
  });
});
