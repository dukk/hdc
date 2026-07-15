import { describe, expect, it } from "vitest";
import {
  pickStorageSpecsFromRows,
  storageIdsFromConfig,
  storageMaintainEnabledFromConfig,
  storageSpecForNodes,
  storageSpecsMatch,
  storageSpecToFormFields,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-storage-maintain.mjs";
import { pveProfileForMajor } from "hdc/clump/infrastructure/proxmox/lib/pve-version.mjs";

describe("proxmox storage maintain", () => {
  it("storageIdsFromConfig defaults to nas-a and nas-b", () => {
    expect(storageIdsFromConfig({})).toEqual(["nas-a", "nas-b"]);
    expect(storageIdsFromConfig({ provision: { storage: { ids: ["nas-a"] } } })).toEqual(["nas-a"]);
  });

  it("storageMaintainEnabledFromConfig respects enabled flag", () => {
    expect(storageMaintainEnabledFromConfig({ provision: { storage: { enabled: false } } })).toBe(
      false,
    );
    expect(storageMaintainEnabledFromConfig({ provision: {} })).toBe(true);
  });

  it("pickStorageSpecsFromRows filters by id", () => {
    const rows = [
      { storage: "local", type: "dir" },
      { storage: "nas-a", type: "nfs", server: "192.0.2.9", export: "/vol", path: "/mnt/pve/nas-a" },
    ];
    const picked = pickStorageSpecsFromRows(rows, ["nas-a", "nas-b"]);
    expect(picked).toHaveLength(1);
    expect(picked[0].storage).toBe("nas-a");
    expect(picked[0].type).toBe("nfs");
  });

  it("storageSpecForNodes sets nodes list", () => {
    const spec = storageSpecForNodes({ storage: "nas-a", type: "nfs" }, ["hypervisor-a", "hypervisor-b"]);
    expect(spec.nodes).toBe("hypervisor-a,hypervisor-b");
  });

  it("storageSpecsMatch compares content and nodes order-independently", () => {
    const a = { type: "nfs", content: "images,iso", nodes: "hypervisor-b,hypervisor-a" };
    const b = { type: "nfs", content: "iso,images", nodes: "hypervisor-a,hypervisor-b" };
    expect(storageSpecsMatch(a, b)).toBe(true);
    expect(storageSpecsMatch(a, { ...b, server: "192.0.2.9" })).toBe(false);
  });

  it("storageSpecToFormFields omits password_vault_key", () => {
    const fields = storageSpecToFormFields({
      storage: "nas-a",
      type: "nfs",
      password_vault_key: "HDC_SECRET",
      server: "192.0.2.9",
    });
    expect(fields.password_vault_key).toBeUndefined();
    expect(fields.server).toBe("192.0.2.9");
  });

  it("storageSpecToFormFields forUpdate omits type and fixed NFS/CIFS fields", () => {
    const fields = storageSpecToFormFields(
      {
        storage: "nas-a",
        type: "nfs",
        server: "192.0.2.9",
        export: "/vol",
        path: "/mnt/pve/nas-a",
        share: "data",
        nodes: "hypervisor-a,hypervisor-b",
        content: "images",
      },
      {},
      { forUpdate: true, profile: pveProfileForMajor(9) },
    );
    expect(fields).toEqual({ nodes: "hypervisor-a,hypervisor-b", content: "images" });
  });
});
