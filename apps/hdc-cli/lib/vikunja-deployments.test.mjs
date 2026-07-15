import { describe, expect, it } from "vitest";
import {
  dbPasswordVaultKeyFromConfig,
  instanceFlagToSystemId,
  jwtSecretVaultKeyFromConfig,
  listVikunjaDeploymentSummaries,
  normalizeVikunjaConfig,
  resolveVikunjaDeployments,
} from "hdc/clump/services/vikunja/lib/deployments.mjs";

describe("vikunja deployments", () => {
  const v2 = {
    schema_version: 2,
    defaults: {
      mode: "proxmox-lxc",
      proxmox: { lxc: { rootfs_gb: 20, memory_mb: 2048, cores: 2 } },
      vikunja: {
        host_port: 3456,
        public_url: "https://tasks.example.invalid/",
        image_tag: "latest",
      },
    },
    deployments: [
      {
        system_id: "vikunja-a",
        proxmox: { host_id: "hypervisor-a", lxc: { vmid: 510 } },
      },
    ],
  };

  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeVikunjaConfig(v2);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("vikunja-a");
  });

  it("rejects invalid system_id prefix", () => {
    expect(() =>
      normalizeVikunjaConfig({
        schema_version: 2,
        deployments: [
          { system_id: "vm-vikunja-a", proxmox: { host_id: "hypervisor-a", lxc: { vmid: 1 } } },
        ],
      }),
    ).toThrow(/vikunja/);
  });

  it("resolves single deployment", () => {
    const list = resolveVikunjaDeployments(v2, {});
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("vikunja-a");
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("a")).toBe("vikunja-a");
    expect(instanceFlagToSystemId("vikunja-a")).toBe("vikunja-a");
  });

  it("lists deployment summaries", () => {
    const list = listVikunjaDeploymentSummaries(v2);
    expect(list[0]).toMatchObject({
      system_id: "vikunja-a",
      host_id: "hypervisor-a",
      vmid: 510,
      host_port: 3456,
      public_url: "https://tasks.example.invalid",
    });
  });

  it("defaults vault keys", () => {
    expect(jwtSecretVaultKeyFromConfig({})).toBe("HDC_VIKUNJA_JWT_SECRET");
    expect(dbPasswordVaultKeyFromConfig({})).toBe("HDC_VIKUNJA_DB_PASSWORD");
    expect(jwtSecretVaultKeyFromConfig({ jwt_secret_vault_key: "CUSTOM_JWT" })).toBe("CUSTOM_JWT");
  });
});
