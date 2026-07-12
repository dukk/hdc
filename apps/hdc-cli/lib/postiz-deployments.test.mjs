import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listPostizDeploymentSummaries,
  normalizePostizConfig,
  resolvePostizDeployments,
} from "../../../clumps/services/postiz/lib/deployments.mjs";

const baseCfg = {
  schema_version: 2,
  defaults: {
    mode: "proxmox-lxc",
    postiz: { version: "latest", listen_port: 80 },
  },
  deployments: [
    {
      system_id: "postiz-a",
      proxmox: { host_id: "hypervisor-a", lxc: { vmid: 490, hostname: "postiz-a" } },
    },
  ],
};

describe("postiz deployments", () => {
  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizePostizConfig(baseCfg);
    expect(deployments[0].system_id).toBe("postiz-a");
  });

  it("rejects non-ct system_id", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].system_id = "vm-postiz-a";
    expect(() => normalizePostizConfig(bad)).toThrow(/postiz/);
  });

  it("listPostizDeploymentSummaries", () => {
    const list = listPostizDeploymentSummaries(baseCfg);
    expect(list[0].system_id).toBe("postiz-a");
    expect(list[0].version).toBe("latest");
    expect(list[0].listen_port).toBe(80);
  });

  it("instanceFlagToSystemId", () => {
    expect(instanceFlagToSystemId("a")).toBe("postiz-a");
    expect(instanceFlagToSystemId("postiz-a")).toBe("postiz-a");
  });

  it("resolvePostizDeployments honors --instance", () => {
    const list = resolvePostizDeployments(baseCfg, { instance: "a" });
    expect(list[0].systemId).toBe("postiz-a");
  });
});
