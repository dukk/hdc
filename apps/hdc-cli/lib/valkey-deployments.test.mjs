import { describe, expect, it } from "vitest";
import {
  clusterEndpointsFromDeployments,
  normalizeValkeyConfig,
  valkeyGlobalSettings,
  resolveValkeyDeployments,
} from "../../../clumps/services/valkey/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  valkey: { port: 6379, min_masters: 3 },
  defaults: { mode: "configure-only" },
  deployments: [
    {
      system_id: "vm-valkey-a",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.33" } },
    },
    {
      system_id: "vm-valkey-b",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.34" } },
    },
    {
      system_id: "vm-valkey-c",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.35" } },
    },
  ],
};

describe("valkey-deployments", () => {
  it("normalizes config with exactly three deployments", () => {
    const n = normalizeValkeyConfig(sampleCfg);
    expect(n.deployments).toHaveLength(3);
    expect(n.minMasters).toBe(3);
  });

  it("rejects wrong deployment count", () => {
    expect(() =>
      normalizeValkeyConfig({
        ...sampleCfg,
        deployments: sampleCfg.deployments.slice(0, 2),
      }),
    ).toThrow(/exactly 3 deployments/);
  });

  it("rejects invalid system_id", () => {
    expect(() =>
      normalizeValkeyConfig({
        ...sampleCfg,
        deployments: [
          { system_id: "vm-valkey-1", mode: "configure-only", configure: { ssh: { host: "192.0.2.33" } } },
          { system_id: "vm-valkey-b", mode: "configure-only", configure: { ssh: { host: "192.0.2.34" } } },
          { system_id: "vm-valkey-c", mode: "configure-only", configure: { ssh: { host: "192.0.2.35" } } },
        ],
      }),
    ).toThrow(/vm-valkey-<letter>/);
  });

  it("resolves single instance by --instance", () => {
    const list = resolveValkeyDeployments(sampleCfg, { instance: "b" });
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("vm-valkey-b");
  });

  it("resolves all nodes when unfiltered", () => {
    const list = resolveValkeyDeployments(sampleCfg, {});
    expect(list).toHaveLength(3);
  });

  it("valkeyGlobalSettings reads vault key", () => {
    const g = valkeyGlobalSettings(normalizeValkeyConfig(sampleCfg));
    expect(g.passwordVaultKey).toBe("HDC_VALKEY_PASSWORD");
    expect(g.port).toBe(6379);
    expect(g.clusterReplicas).toBe(0);
  });

  it("clusterEndpointsFromDeployments builds host:port list", () => {
    const deployments = resolveValkeyDeployments(sampleCfg, {});
    const g = valkeyGlobalSettings(normalizeValkeyConfig(sampleCfg));
    const eps = clusterEndpointsFromDeployments(deployments, g);
    expect(eps).toHaveLength(3);
    expect(eps[0].host).toBe("192.0.2.33");
    expect(eps[0].port).toBe(6379);
  });
});
