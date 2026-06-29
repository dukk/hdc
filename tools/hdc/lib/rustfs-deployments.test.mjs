import { describe, expect, it } from "vitest";
import {
  REQUIRED_NODE_COUNT,
  clusterPeersFromDeployments,
  instanceFlagToSystemId,
  normalizeRustfsConfig,
  resolveRustfsDeployments,
} from "../../../packages/services/rustfs/lib/deployments.mjs";

describe("rustfs deployments", () => {
  const baseDeployment = (letter, vmid, ip) => ({
    system_id: `rustfs-${letter}`,
    proxmox: {
      host_id: "pve-a",
      lxc: {
        vmid,
        hostname: `rustfs-${letter}`,
        ip_config: `ip=${ip}/24,gw=192.0.2.1`,
      },
    },
  });

  const validCfg = {
    schema_version: 2,
    rustfs: { image: "rustfs/rustfs:latest", cluster_dns_suffix: ".hdc.example.org" },
    defaults: { mode: "proxmox-lxc" },
    deployments: [
      baseDeployment("a", 501, "192.0.2.41"),
      baseDeployment("b", 502, "192.0.2.42"),
      baseDeployment("c", 503, "192.0.2.43"),
      baseDeployment("d", 504, "192.0.2.44"),
    ],
  };

  it("requires exactly four deployments", () => {
    expect(REQUIRED_NODE_COUNT).toBe(4);
    expect(() =>
      normalizeRustfsConfig({
        schema_version: 2,
        deployments: [baseDeployment("a", 501, "192.0.2.41")],
      }),
    ).toThrow(/exactly 4 deployments/);
  });

  it("normalizes valid four-node config", () => {
    const norm = normalizeRustfsConfig(validCfg);
    expect(norm.deployments).toHaveLength(4);
    expect(norm.deployments[0].system_id).toBe("rustfs-a");
  });

  it("builds cluster peers with dns suffix", () => {
    const { deployments, rustfs } = normalizeRustfsConfig(validCfg);
    const peers = clusterPeersFromDeployments(deployments, rustfs);
    expect(peers).toHaveLength(4);
    expect(peers[0]).toEqual({ systemId: "rustfs-a", hostname: "rustfs-a.hdc.example.org" });
    expect(peers[3].hostname).toBe("rustfs-d.hdc.example.org");
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("a")).toBe("rustfs-a");
    expect(instanceFlagToSystemId("rustfs-b")).toBe("rustfs-b");
  });

  it("filters deployments by instance", () => {
    const selected = resolveRustfsDeployments(validCfg, { instance: "b" });
    expect(selected).toHaveLength(1);
    expect(selected[0].systemId).toBe("rustfs-b");
  });

  it("returns all four when no filter", () => {
    const all = resolveRustfsDeployments(validCfg, {});
    expect(all).toHaveLength(4);
    expect(all.map((d) => d.systemId)).toEqual(["rustfs-a", "rustfs-b", "rustfs-c", "rustfs-d"]);
  });

  it("rejects duplicate vmid", () => {
    expect(() =>
      normalizeRustfsConfig({
        schema_version: 2,
        deployments: [
          baseDeployment("a", 501, "192.0.2.41"),
          baseDeployment("b", 501, "192.0.2.42"),
          baseDeployment("c", 503, "192.0.2.43"),
          baseDeployment("d", 504, "192.0.2.44"),
        ],
      }),
    ).toThrow(/duplicate proxmox.lxc.vmid/);
  });
});
