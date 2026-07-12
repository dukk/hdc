import { describe, expect, it } from "vitest";
import {
  clusterEndpointsFromDeployments,
  normalizeRedisConfig,
  redisGlobalSettings,
  resolveRedisDeployments,
} from "../../../clumps/services/redis/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  redis: { port: 6379, min_masters: 3 },
  defaults: { mode: "configure-only" },
  deployments: [
    {
      system_id: "vm-redis-a",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.30" } },
    },
    {
      system_id: "vm-redis-b",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.31" } },
    },
    {
      system_id: "vm-redis-c",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.32" } },
    },
  ],
};

describe("redis-deployments", () => {
  it("normalizes config with exactly three deployments", () => {
    const n = normalizeRedisConfig(sampleCfg);
    expect(n.deployments).toHaveLength(3);
    expect(n.minMasters).toBe(3);
  });

  it("rejects wrong deployment count", () => {
    expect(() =>
      normalizeRedisConfig({
        ...sampleCfg,
        deployments: sampleCfg.deployments.slice(0, 2),
      }),
    ).toThrow(/exactly 3 deployments/);
  });

  it("rejects invalid system_id", () => {
    expect(() =>
      normalizeRedisConfig({
        ...sampleCfg,
        deployments: [
          { system_id: "vm-redis-1", mode: "configure-only", configure: { ssh: { host: "192.0.2.30" } } },
          { system_id: "vm-redis-b", mode: "configure-only", configure: { ssh: { host: "192.0.2.31" } } },
          { system_id: "vm-redis-c", mode: "configure-only", configure: { ssh: { host: "192.0.2.32" } } },
        ],
      }),
    ).toThrow(/vm-redis-<letter>/);
  });

  it("resolves single instance by --instance", () => {
    const list = resolveRedisDeployments(sampleCfg, { instance: "b" });
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("vm-redis-b");
  });

  it("resolves all nodes when unfiltered", () => {
    const list = resolveRedisDeployments(sampleCfg, {});
    expect(list).toHaveLength(3);
  });

  it("redisGlobalSettings reads vault key", () => {
    const g = redisGlobalSettings(normalizeRedisConfig(sampleCfg));
    expect(g.passwordVaultKey).toBe("HDC_REDIS_PASSWORD");
    expect(g.port).toBe(6379);
    expect(g.clusterReplicas).toBe(0);
  });

  it("clusterEndpointsFromDeployments builds host:port list", () => {
    const deployments = resolveRedisDeployments(sampleCfg, {});
    const g = redisGlobalSettings(normalizeRedisConfig(sampleCfg));
    const eps = clusterEndpointsFromDeployments(deployments, g);
    expect(eps).toHaveLength(3);
    expect(eps[0].host).toBe("192.0.2.30");
    expect(eps[0].port).toBe(6379);
  });
});
