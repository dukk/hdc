import { describe, expect, it } from "vitest";
import {
  dbPasswordVaultKeyFromConfig,
  instanceFlagToSystemId,
  listAffineDeploymentSummaries,
  normalizeAffineConfig,
  resolveAffineDeployments,
} from "hdc/clump/services/affine/lib/deployments.mjs";

describe("affine deployments", () => {
  const v2 = {
    schema_version: 2,
    defaults: {
      mode: "proxmox-lxc",
      proxmox: { lxc: { rootfs_gb: 32, memory_mb: 4096, cores: 4 } },
      affine: {
        host_port: 3010,
        revision: "stable",
        postgres_image: "pgvector/pgvector:pg16",
        redis_image: "redis:7.4-alpine",
      },
    },
    deployments: [
      {
        system_id: "affine-a",
        proxmox: { host_id: "hypervisor-a", lxc: { vmid: 511 } },
      },
    ],
  };

  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeAffineConfig(v2);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("affine-a");
  });

  it("rejects invalid system_id prefix", () => {
    expect(() =>
      normalizeAffineConfig({
        schema_version: 2,
        deployments: [
          { system_id: "vm-affine-a", proxmox: { host_id: "hypervisor-a", lxc: { vmid: 1 } } },
        ],
      }),
    ).toThrow(/affine/);
  });

  it("resolves single deployment", () => {
    const list = resolveAffineDeployments(v2, {});
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("affine-a");
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("a")).toBe("affine-a");
    expect(instanceFlagToSystemId("affine-a")).toBe("affine-a");
  });

  it("lists deployment summaries", () => {
    const list = listAffineDeploymentSummaries(v2);
    expect(list[0]).toMatchObject({
      system_id: "affine-a",
      host_id: "hypervisor-a",
      vmid: 511,
      host_port: 3010,
      revision: "stable",
    });
  });

  it("defaults vault key", () => {
    expect(dbPasswordVaultKeyFromConfig({})).toBe("HDC_AFFINE_DB_PASSWORD");
    expect(dbPasswordVaultKeyFromConfig({ db_password_vault_key: "CUSTOM_DB" })).toBe("CUSTOM_DB");
  });
});
