import { describe, expect, it } from "vitest";
import {
  pickStorageSpecsFromRows,
  storageIdsFromConfig,
  storageMaintainEnabledFromConfig,
  storageSpecForNodes,
  storageSpecsMatch,
  storageSpecToFormFields,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-storage-maintain.mjs";
import { pveProfileForMajor } from "../../../packages/infrastructure/proxmox/lib/pve-version.mjs";

describe("proxmox storage maintain", () => {
  it("storageIdsFromConfig defaults to nas-1 and nas-2", () => {
    expect(storageIdsFromConfig({})).toEqual(["nas-1", "nas-2"]);
    expect(storageIdsFromConfig({ provision: { storage: { ids: ["nas-1"] } } })).toEqual(["nas-1"]);
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
      { storage: "nas-1", type: "nfs", server: "10.0.0.9", export: "/vol", path: "/mnt/pve/nas-1" },
    ];
    const picked = pickStorageSpecsFromRows(rows, ["nas-1", "nas-2"]);
    expect(picked).toHaveLength(1);
    expect(picked[0].storage).toBe("nas-1");
    expect(picked[0].type).toBe("nfs");
  });

  it("storageSpecForNodes sets nodes list", () => {
    const spec = storageSpecForNodes({ storage: "nas-1", type: "nfs" }, ["pve-a", "pve-b"]);
    expect(spec.nodes).toBe("pve-a,pve-b");
  });

  it("storageSpecsMatch compares content and nodes order-independently", () => {
    const a = { type: "nfs", content: "images,iso", nodes: "pve-b,pve-a" };
    const b = { type: "nfs", content: "iso,images", nodes: "pve-a,pve-b" };
    expect(storageSpecsMatch(a, b)).toBe(true);
    expect(storageSpecsMatch(a, { ...b, server: "10.0.0.9" })).toBe(false);
  });

  it("storageSpecToFormFields omits password_vault_key", () => {
    const fields = storageSpecToFormFields({
      storage: "nas-1",
      type: "nfs",
      password_vault_key: "HDC_SECRET",
      server: "10.0.0.9",
    });
    expect(fields.password_vault_key).toBeUndefined();
    expect(fields.server).toBe("10.0.0.9");
  });

  it("storageSpecToFormFields forUpdate omits type and fixed NFS/CIFS fields", () => {
    const fields = storageSpecToFormFields(
      {
        storage: "nas-1",
        type: "nfs",
        server: "10.0.0.9",
        export: "/vol",
        path: "/mnt/pve/nas-1",
        share: "data",
        nodes: "pve-a,pve-b",
        content: "images",
      },
      {},
      { forUpdate: true, profile: pveProfileForMajor(9) },
    );
    expect(fields).toEqual({ nodes: "pve-a,pve-b", content: "images" });
  });
});
