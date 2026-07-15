import { describe, expect, it } from "vitest";
import {
  growRootFilesystemScript,
  locateQemuGuestByName,
  resolveDeploymentHostname,
  resolveRootfsGbFromDeployment,
  syncQemuRootfsOnMaintain,
} from "hdc/package/qemu-rootfs-resize.mjs";

describe("qemu-rootfs-resize", () => {
  it("growRootFilesystemScript includes growpart and resize2fs", () => {
    const script = growRootFilesystemScript();
    expect(script).toContain("growpart");
    expect(script).toContain("resize2fs");
    expect(script).toContain("cloud-guest-utils");
  });

  it("resolveRootfsGbFromDeployment reads proxmox.qemu.rootfs_gb", () => {
    expect(
      resolveRootfsGbFromDeployment({
        proxmox: { qemu: { rootfs_gb: 16 } },
      }),
    ).toBe(16);
    expect(resolveRootfsGbFromDeployment({ proxmox: { qemu: {} } })).toBeNull();
  });

  it("resolveDeploymentHostname prefers hostname over system_id", () => {
    expect(
      resolveDeploymentHostname({ hostname: "bind-a", system_id: "vm-bind-a" }),
    ).toBe("bind-a");
    expect(resolveDeploymentHostname({ system_id: "vm-bind-b" })).toBe("bind-b");
  });

  it("locateQemuGuestByName matches cluster resources", () => {
    const resources = [
      { type: "qemu", vmid: 108, node: "pve-b", name: "bind-a", maxdisk: 2 * 1024 ** 3 },
    ];
    const found = locateQemuGuestByName(resources, "bind-a");
    expect(found?.vmid).toBe(108);
    expect(found?.maxdisk).toBe(2 * 1024 ** 3);
  });

  it("syncQemuRootfsOnMaintain skips with --skip-disk-resize", async () => {
    const result = await syncQemuRootfsOnMaintain({
      proxmoxPackageRoot: "/tmp/proxmox",
      deployment: { mode: "proxmox-qemu", proxmox: { qemu: { rootfs_gb: 16 } } },
      flags: { "skip-disk-resize": "1" },
    });
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("--skip-disk-resize");
  });

  it("syncQemuRootfsOnMaintain skips non-proxmox-qemu deployments", async () => {
    const result = await syncQemuRootfsOnMaintain({
      proxmoxPackageRoot: "/tmp/proxmox",
      deployment: { mode: "configure-only", proxmox: { qemu: { rootfs_gb: 16 } } },
      flags: {},
    });
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("not proxmox-qemu");
  });

  it("syncQemuRootfsOnMaintain skips when rootfs_gb is unset", async () => {
    const result = await syncQemuRootfsOnMaintain({
      proxmoxPackageRoot: "/tmp/proxmox",
      deployment: { mode: "proxmox-qemu", proxmox: { host_id: "pve-b", qemu: {} } },
      flags: {},
    });
    expect(result.skipped).toBe(true);
    expect(result.message).toContain("no rootfs_gb");
  });
});
