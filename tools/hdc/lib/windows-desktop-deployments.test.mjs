import { describe, expect, it } from "vitest";
import {
  normalizeWindowsDesktopConfig,
  parseIsoVolid,
  resolveWindowsDesktopDeployments,
} from "../../../packages/services/windows-desktop/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  windows_desktop: { admin_vault_key: "HDC_WINDOWS_DESKTOP_ADMIN_PASSWORD" },
  defaults: {
    mode: "proxmox-qemu-clone",
    proxmox: {
      host_id: "pve-b",
      qemu: { storage: "local-lvm", iso_storage: "local", disk_format: "raw" },
      iso: {
        windows_volid: "local:iso/win.iso",
        virtio_volid: "local:iso/virtio-win.iso",
      },
      template: { vmid: 9001, name: "win11-template" },
      oem: { enabled: true },
    },
  },
  deployments: [
    {
      system_id: "vm-win11-a",
      hostname: "win11-a",
      proxmox: { qemu: { vmid: 200, ip: "10.0.0.50/24" } },
    },
  ],
};

describe("windows-desktop deployments", () => {
  it("normalizeWindowsDesktopConfig accepts vm-win11-a", () => {
    const n = normalizeWindowsDesktopConfig(sampleCfg);
    expect(n.deployments).toHaveLength(1);
    expect(n.deployments[0].system_id).toBe("vm-win11-a");
  });

  it("resolveWindowsDesktopDeployments filters by instance", () => {
    const d = resolveWindowsDesktopDeployments(sampleCfg, { instance: "a" });
    expect(d).toHaveLength(1);
    expect(d[0].systemId).toBe("vm-win11-a");
    expect(d[0].proxmox.hostId).toBe("pve-b");
    expect(d[0].mode).toBe("proxmox-qemu-clone");
    expect(d[0].proxmox.template.vmid).toBe(9001);
  });

  it("parseIsoVolid splits storage and path", () => {
    expect(parseIsoVolid("local:iso/Win11.iso")).toEqual({
      storage: "local",
      filename: "iso/Win11.iso",
    });
  });
});
