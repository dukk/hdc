import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listGatusDeploymentSummaries,
  normalizeGatusConfig,
  resolveGatusDeployments,
} from "../../../clumps/services/gatus/lib/deployments.mjs";
import { normalizeGatusVersion } from "../../../clumps/services/gatus/lib/gatus-install.mjs";

describe("gatus deployments", () => {
  const v2 = {
    schema_version: 2,
    defaults: { mode: "proxmox-lxc", gatus: { version: "v5.36.0" } },
    deployments: [
      {
        system_id: "gatus-a",
        proxmox: { host_id: "hypervisor-a", lxc: { vmid: 140 } },
      },
    ],
  };

  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeGatusConfig(v2);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("gatus-a");
  });

  it("resolves single deployment", () => {
    const list = resolveGatusDeployments(v2, {});
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("gatus-a");
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("a")).toBe("gatus-a");
    expect(instanceFlagToSystemId("gatus-a")).toBe("gatus-a");
  });

  it("lists deployment summaries", () => {
    const list = listGatusDeploymentSummaries(v2);
    expect(list[0].system_id).toBe("gatus-a");
    expect(list[0].version).toBe("v5.36.0");
    expect(list[0].listen_port).toBe(8080);
  });

  it("rejects invalid system_id", () => {
    const bad = structuredClone(v2);
    bad.deployments[0].system_id = "vm-gatus-a";
    expect(() => normalizeGatusConfig(bad)).toThrow(/gatus/);
  });

  it("normalizeGatusVersion accepts tags", () => {
    expect(normalizeGatusVersion("v5.36.0")).toBe("v5.36.0");
    expect(normalizeGatusVersion("5.36.0")).toBe("v5.36.0");
    expect(normalizeGatusVersion("latest")).toBe("v5.36.0");
  });
});
