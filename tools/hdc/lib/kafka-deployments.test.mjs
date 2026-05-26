import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  kafkaGlobalSettings,
  normalizeKafkaConfig,
  resolveAllKafkaDeployments,
  resolveKafkaDeployments,
} from "../../../packages/services/kafka/lib/deployments.mjs";

const clusterId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const sampleCfg = {
  schema_version: 2,
  kafka: {
    cluster_id: clusterId,
    version: "3.9.0",
    listener_port: 9092,
    controller_port: 9093,
    log_dirs: ["/var/lib/kafka/data"],
  },
  defaults: {
    mode: "proxmox-qemu",
    proxmox: { qemu: { template_vmid: 9024 } },
  },
  deployments: [
    {
      system_id: "vm-kafka-a",
      node_id: 1,
      configure: { ssh: { host: "192.0.2.21" } },
      proxmox: { host_id: "hypervisor-a", qemu: { vmid: 201 } },
    },
    {
      system_id: "vm-kafka-b",
      node_id: 2,
      configure: { ssh: { host: "192.0.2.22" } },
      proxmox: { host_id: "hypervisor-b", qemu: { vmid: 202 } },
    },
    {
      system_id: "vm-kafka-c",
      node_id: 3,
      configure: { ssh: { host: "192.0.2.23" } },
      proxmox: { host_id: "hypervisor-c", qemu: { vmid: 203 } },
    },
  ],
};

describe("kafka deployments", () => {
  it("normalizes three deployments", () => {
    const { deployments } = normalizeKafkaConfig(sampleCfg);
    expect(deployments).toHaveLength(3);
    expect(deployments[0].system_id).toBe("vm-kafka-a");
  });

  it("rejects wrong deployment count", () => {
    expect(() =>
      normalizeKafkaConfig({
        kafka: { cluster_id: clusterId },
        deployments: [{ system_id: "vm-kafka-a", node_id: 1, configure: { ssh: { host: "192.0.2.21" } } }],
      }),
    ).toThrow(/exactly 3/);
  });

  it("rejects invalid cluster_id", () => {
    expect(() =>
      kafkaGlobalSettings(
        normalizeKafkaConfig({
          ...sampleCfg,
          kafka: { cluster_id: "not-a-uuid" },
        }),
      ),
    ).toThrow(/UUID/);
  });

  it("maps --instance b to vm-kafka-b", () => {
    expect(instanceFlagToSystemId("b")).toBe("vm-kafka-b");
    const one = resolveKafkaDeployments(sampleCfg, { instance: "b" });
    expect(one).toHaveLength(1);
    expect(one[0].systemId).toBe("vm-kafka-b");
    expect(one[0].nodeId).toBe(2);
  });

  it("resolveAllKafkaDeployments returns sorted nodes", () => {
    const all = resolveAllKafkaDeployments(sampleCfg);
    expect(all.map((d) => d.nodeId)).toEqual([1, 2, 3]);
  });

  it("kafkaGlobalSettings reads cluster settings", () => {
    const g = kafkaGlobalSettings(normalizeKafkaConfig(sampleCfg));
    expect(g.clusterId).toBe(clusterId);
    expect(g.listenerPort).toBe(9092);
    expect(g.version).toBe("3.9.0");
  });
});
