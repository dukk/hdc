import { describe, expect, it } from "vitest";
import {
  buildExtendLocalLvmScript,
  buildExtraPoolScript,
  localLvmExtendEnabledForHost,
  localLvmPoolsForHost,
  localLvmMaintainEnabledFromConfig,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-local-lvm-maintain.mjs";

const fixtureCfg = {
  schema_version: 1,
  clusters: [
    {
      id: "c1",
      hosts: [
        { id: "hypervisor-b", pve_node: "hypervisor-b", ip: "192.0.2.12", web_ui: "https://192.0.2.12:8006", ssh: "ssh://root@192.0.2.12" },
        {
          id: "hypervisor-d",
          pve_node: "hypervisor-d",
          ip: "192.0.2.15",
          web_ui: "https://192.0.2.15:8006",
          ssh: "ssh://root@192.0.2.15",
          local_lvm: {
            extend: false,
            pools: [
              {
                storage_id: "local-lvm-mirrored",
                vg: "pve-mirror",
                thin_pool: "data",
                raid: {
                  level: 0,
                  devices: ["/dev/disk/by-id/disk-a", "/dev/disk/by-id/disk-b"],
                },
              },
            ],
          },
        },
      ],
    },
  ],
  provision: {
    local_lvm: {
      extend: { enabled: true, vg: "pve", thin_pool: "data", storage_id: "local-lvm" },
      extra_pools: { enabled: true, content: "images,rootdir" },
    },
  },
};

describe("proxmox local-lvm maintain", () => {
  it("localLvmMaintainEnabledFromConfig respects global flags", () => {
    expect(localLvmMaintainEnabledFromConfig(fixtureCfg)).toBe(true);
    expect(
      localLvmMaintainEnabledFromConfig({
        ...fixtureCfg,
        provision: { local_lvm: { extend: { enabled: false }, extra_pools: { enabled: false } } },
      }),
    ).toBe(false);
  });

  it("localLvmExtendEnabledForHost merges global and per-host extend", () => {
    expect(localLvmExtendEnabledForHost(fixtureCfg, "hypervisor-b")).toBe(true);
    expect(localLvmExtendEnabledForHost(fixtureCfg, "hypervisor-d")).toBe(false);
  });

  it("localLvmPoolsForHost returns RAID devices for hypervisor-d", () => {
    const pools = localLvmPoolsForHost(fixtureCfg, "hypervisor-d");
    expect(pools).toHaveLength(1);
    expect(pools[0].storageId).toBe("local-lvm-mirrored");
    expect(pools[0].vg).toBe("pve-mirror");
    expect(pools[0].devices).toEqual(["/dev/disk/by-id/disk-a", "/dev/disk/by-id/disk-b"]);
    expect(localLvmPoolsForHost(fixtureCfg, "hypervisor-b")).toEqual([]);
  });

  it("localLvmPoolsForHost accepts single-device extra pools", () => {
    const cfg = {
      ...fixtureCfg,
      clusters: [
        {
          id: "c1",
          hosts: [
            {
              id: "pve-a",
              pve_node: "pve-a",
              ip: "192.0.2.11",
              web_ui: "https://192.0.2.11:8006",
              ssh: "ssh://root@192.0.2.11",
              local_lvm: {
                extend: false,
                pools: [
                  {
                    storage_id: "local-lvm-data",
                    vg: "pve-data",
                    thin_pool: "data",
                    raid: { level: 0, devices: ["/dev/disk/by-id/ssd-a"] },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const pools = localLvmPoolsForHost(cfg, "pve-a");
    expect(pools).toHaveLength(1);
    expect(pools[0].devices).toEqual(["/dev/disk/by-id/ssd-a"]);
  });

  it("buildExtendLocalLvmScript contains growpart and lvextend", () => {
    const script = buildExtendLocalLvmScript({ vg: "pve", thinPool: "data", storageId: "local-lvm" });
    expect(script).toContain("growpart");
    expect(script).toContain("lvextend -l +100%FREE");
    expect(script).toContain("pvresize");
    expect(script).toContain("local-lvm");
    expect(script).toContain("lsblk -no PARTN");
    expect(script).toContain("lsblk -no PKNAME");
    expect(script).toContain("PKNAME=");
    expect(script).toContain("pvs --noheadings -o pv_name,vg_name");
    expect(script).toContain("vg_free");
    expect(script).toContain("nvme*n*p");
    expect(script).not.toContain("partx -ovNR");
  });

  it("buildExtraPoolScript contains mdadm and pvesm add lvmthin", () => {
    const script = buildExtraPoolScript({
      storageId: "local-lvm-mirrored",
      vg: "pve-mirror",
      thinPool: "data",
      content: "images,rootdir",
      mdName: "pve-mirror",
      raidLevel: 0,
      devices: ["/dev/disk/by-id/a", "/dev/disk/by-id/b"],
    });
    expect(script).toContain("mdadm --create");
    expect(script).toContain("pvesm add lvmthin");
    expect(script).toContain("--vgname");
    expect(script).toContain("--thinpool");
    expect(script).toContain("local-lvm-mirrored");
    expect(script).toContain("/dev/disk/by-id/a");
  });

  it("buildExtraPoolScript skips mdadm for a single device", () => {
    const script = buildExtraPoolScript({
      storageId: "local-lvm-data",
      vg: "pve-data",
      thinPool: "data",
      content: "images,rootdir",
      mdName: "pve-data",
      raidLevel: 0,
      devices: ["/dev/disk/by-id/ssd-a"],
    });
    expect(script).toContain("Single-disk pool");
    expect(script.split("else")[0]).not.toContain("mdadm --create");
    expect(script).toContain("pvcreate");
    expect(script).toContain("/dev/disk/by-id/ssd-a");
  });
});
