import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listScanopyDeploymentSummaries,
  normalizeScanopyConfig,
  postgresPasswordVaultKey,
  resolveScanopyDeployments,
} from "hdc/clump/services/scanopy/lib/deployments.mjs";

describe("scanopy deployments", () => {
  const v2 = {
    schema_version: 2,
    defaults: {
      mode: "proxmox-lxc",
      proxmox: { lxc: { rootfs_gb: 32, memory_mb: 4096, cores: 4 } },
      scanopy: { release: "latest", port: 60072 },
    },
    deployments: [
      {
        system_id: "scanopy-a",
        proxmox: { host_id: "hypervisor-a", lxc: { vmid: 485 } },
      },
    ],
  };

  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeScanopyConfig(v2);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("scanopy-a");
  });

  it("rejects invalid system_id prefix", () => {
    expect(() =>
      normalizeScanopyConfig({
        schema_version: 2,
        deployments: [{ system_id: "vm-scanopy-a", proxmox: { host_id: "hypervisor-a", lxc: { vmid: 1 } } }],
      }),
    ).toThrow(/scanopy/);
  });

  it("resolves single deployment", () => {
    const list = resolveScanopyDeployments(v2, {});
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("scanopy-a");
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("a")).toBe("scanopy-a");
    expect(instanceFlagToSystemId("scanopy-a")).toBe("scanopy-a");
  });

  it("lists deployment summaries", () => {
    const list = listScanopyDeploymentSummaries(v2);
    expect(list[0]).toMatchObject({
      system_id: "scanopy-a",
      host_id: "hypervisor-a",
      vmid: 485,
      port: 60072,
    });
  });

  it("defaults postgres vault key", () => {
    expect(postgresPasswordVaultKey({})).toBe("HDC_SCANOPY_POSTGRES_PASSWORD");
    expect(postgresPasswordVaultKey({ postgres_password_vault_key: "CUSTOM" })).toBe("CUSTOM");
  });
});

describe("scanopy render", () => {
  it("composeFileUrl for latest and tags", async () => {
    const { composeFileUrl, renderScanopyEnv, resolvePublicUrl } = await import(
      "hdc/clump/services/scanopy/lib/scanopy-render.mjs"
    );
    expect(composeFileUrl("latest")).toContain("/refs/heads/main/");
    expect(composeFileUrl("v0.16.2")).toContain("/refs/tags/v0.16.2/");
    expect(composeFileUrl("0.16.2")).toContain("/refs/tags/v0.16.2/");
    const env = renderScanopyEnv({ port: 60072, log_level: "info" }, "secret", "http://192.0.2.50:60072");
    expect(env).toContain("POSTGRES_PASSWORD=secret");
    expect(env).toContain("SCANOPY_PUBLIC_URL=http://192.0.2.50:60072");
    expect(resolvePublicUrl({ port: 60072 }, "192.0.2.50")).toBe("http://192.0.2.50:60072");
    expect(resolvePublicUrl({ public_url: "http://scanopy.example" }, null)).toBe("http://scanopy.example");
  });
});
