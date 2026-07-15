import { describe, expect, it } from "vitest";
import {
  adminPasswordVaultKey,
  httpPort,
  instanceFlagToSystemId,
  listYacyDeploymentSummaries,
  normalizeYacyConfig,
  resolveYacyDeployments,
} from "hdc/clump/services/yacy/lib/deployments.mjs";

describe("yacy deployments", () => {
  const v2 = {
    schema_version: 2,
    defaults: {
      mode: "proxmox-lxc",
      proxmox: { lxc: { rootfs_gb: 64, memory_mb: 4096, cores: 2 } },
      yacy: { image_tag: "latest", http_port: 8090, https_port: 8443, peer_name: "hdc-yacy-a" },
    },
    deployments: [
      {
        system_id: "yacy-a",
        proxmox: { host_id: "hypervisor-a", lxc: { vmid: 486 } },
      },
    ],
  };

  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeYacyConfig(v2);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("yacy-a");
  });

  it("rejects invalid system_id prefix", () => {
    expect(() =>
      normalizeYacyConfig({
        schema_version: 2,
        deployments: [{ system_id: "vm-yacy-a", proxmox: { host_id: "hypervisor-a", lxc: { vmid: 1 } } }],
      }),
    ).toThrow(/yacy/);
  });

  it("resolves single deployment", () => {
    const list = resolveYacyDeployments(v2, {});
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("yacy-a");
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("a")).toBe("yacy-a");
    expect(instanceFlagToSystemId("yacy-a")).toBe("yacy-a");
  });

  it("lists deployment summaries", () => {
    const list = listYacyDeploymentSummaries(v2);
    expect(list[0]).toMatchObject({
      system_id: "yacy-a",
      host_id: "hypervisor-a",
      vmid: 486,
      http_port: 8090,
      https_port: 8443,
      peer_name: "hdc-yacy-a",
    });
  });

  it("defaults admin password vault key", () => {
    expect(adminPasswordVaultKey({})).toBe("HDC_YACY_ADMIN_PASSWORD");
    expect(adminPasswordVaultKey({ admin_password_vault_key: "CUSTOM" })).toBe("CUSTOM");
  });

  it("httpPort defaults to 8090", () => {
    expect(httpPort({})).toBe(8090);
    expect(httpPort({ http_port: 9000 })).toBe(9000);
  });
});
