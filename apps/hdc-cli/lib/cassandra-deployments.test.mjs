import { describe, expect, it } from "vitest";
import {
  bootstrapSortDeployments,
  cassandraAptSuite,
  cassandraGlobalSettings,
  deriveSeedIps,
  normalizeCassandraConfig,
  resolveCassandraDeployments,
} from "../../../clumps/services/cassandra/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  cassandra: {
    cluster_name: "test-cluster",
    version: "5.0",
    datacenter: "hdc",
    rack: "rack1",
  },
  defaults: { mode: "configure-only" },
  deployments: [
    {
      system_id: "vm-cassandra-a",
      seed: true,
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.20" } },
    },
    {
      system_id: "vm-cassandra-b",
      seed: true,
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.21" } },
    },
    {
      system_id: "vm-cassandra-c",
      seed: false,
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.22" } },
    },
  ],
};

describe("cassandra-deployments", () => {
  it("normalizes config with exactly three nodes", () => {
    const n = normalizeCassandraConfig(sampleCfg);
    expect(n.deployments).toHaveLength(3);
    expect(n.cassandra.cluster_name).toBe("test-cluster");
  });

  it("rejects wrong node count", () => {
    expect(() =>
      normalizeCassandraConfig({
        ...sampleCfg,
        deployments: sampleCfg.deployments.slice(0, 2),
      }),
    ).toThrow(/exactly 3/);
  });

  it("orders seeds first when deploying all", () => {
    const list = resolveCassandraDeployments(sampleCfg, {});
    expect(list[0].seed).toBe(true);
    expect(list[1].seed).toBe(true);
    expect(list[2].seed).toBe(false);
  });

  it("deriveSeedIps from seed deployments", () => {
    const ips = deriveSeedIps(sampleCfg.deployments);
    expect(ips).toEqual(["192.0.2.20", "192.0.2.21"]);
  });

  it("cassandraGlobalSettings reads cluster name", () => {
    const deployments = resolveCassandraDeployments(sampleCfg, {});
    const g = cassandraGlobalSettings(normalizeCassandraConfig(sampleCfg), deployments);
    expect(g.clusterName).toBe("test-cluster");
    expect(g.seedIps).toEqual(["192.0.2.20", "192.0.2.21"]);
  });

  it("cassandraAptSuite maps 5.0 to 50x", () => {
    expect(cassandraAptSuite("5.0")).toBe("50x");
    expect(cassandraAptSuite("4.1")).toBe("41x");
  });

  it("bootstrapSortDeployments puts seeds first", () => {
    const sorted = bootstrapSortDeployments([
      { system_id: "vm-cassandra-c", seed: false },
      { system_id: "vm-cassandra-a", seed: true },
      { system_id: "vm-cassandra-b", seed: true },
    ]);
    expect(sorted.map((d) => d.system_id)).toEqual([
      "vm-cassandra-a",
      "vm-cassandra-b",
      "vm-cassandra-c",
    ]);
  });
});
