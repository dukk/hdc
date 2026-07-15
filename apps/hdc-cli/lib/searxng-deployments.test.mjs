import { describe, expect, it } from "vitest";
import {
  hostPort,
  instanceFlagToSystemId,
  instanceName,
  limiterEnabled,
  listSearxngDeploymentSummaries,
  normalizeSearxngConfig,
  resolveSearxngDeployments,
  secretKeyVaultKey,
} from "hdc/clump/services/searxng/lib/deployments.mjs";

describe("searxng deployments", () => {
  const v2 = {
    schema_version: 2,
    defaults: {
      mode: "proxmox-lxc",
      proxmox: { lxc: { rootfs_gb: 16, memory_mb: 2048, cores: 2 } },
      searxng: { image_tag: "latest", host_port: 8080, instance_name: "HDC SearXNG" },
    },
    deployments: [
      {
        system_id: "searxng-a",
        proxmox: { host_id: "pve-c", lxc: { vmid: 492 } },
      },
    ],
  };

  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeSearxngConfig(v2);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("searxng-a");
  });

  it("rejects invalid system_id prefix", () => {
    expect(() =>
      normalizeSearxngConfig({
        schema_version: 2,
        deployments: [
          { system_id: "vm-searxng-a", proxmox: { host_id: "pve-c", lxc: { vmid: 1 } } },
        ],
      }),
    ).toThrow(/searxng/);
  });

  it("resolves single deployment", () => {
    const list = resolveSearxngDeployments(v2, {});
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("searxng-a");
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("a")).toBe("searxng-a");
    expect(instanceFlagToSystemId("searxng-a")).toBe("searxng-a");
  });

  it("lists deployment summaries", () => {
    const list = listSearxngDeploymentSummaries(v2);
    expect(list[0]).toMatchObject({
      system_id: "searxng-a",
      host_id: "pve-c",
      vmid: 492,
      host_port: 8080,
      instance_name: "HDC SearXNG",
      limiter: false,
    });
  });

  it("defaults secret vault key", () => {
    expect(secretKeyVaultKey({})).toBe("HDC_SEARXNG_SECRET");
    expect(secretKeyVaultKey({ secret_key_vault_key: "CUSTOM" })).toBe("CUSTOM");
  });

  it("hostPort defaults to 8080", () => {
    expect(hostPort({})).toBe(8080);
    expect(hostPort({ host_port: 8888 })).toBe(8888);
  });

  it("instanceName and limiter defaults", () => {
    expect(instanceName({})).toBe("SearXNG");
    expect(instanceName({ instance_name: "Home" })).toBe("Home");
    expect(limiterEnabled({})).toBe(false);
    expect(limiterEnabled({ limiter: true })).toBe(true);
  });
});
