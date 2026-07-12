import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listPaperlessNgxDeploymentSummaries,
  normalizePaperlessNgxConfig,
  resolvePaperlessNgxDeployments,
} from "../../../clumps/services/paperless-ngx/lib/deployments.mjs";

const baseCfg = {
  schema_version: 2,
  defaults: {
    mode: "proxmox-lxc",
    paperless_ngx: {
      image_tag: "latest",
      tika_enabled: true,
      host_port: 8000,
    },
  },
  deployments: [
    {
      system_id: "paperless-ngx-a",
      proxmox: { host_id: "pve-c", lxc: { vmid: 502 } },
    },
  ],
};

describe("paperless-ngx deployments", () => {
  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizePaperlessNgxConfig(baseCfg);
    expect(deployments[0].system_id).toBe("paperless-ngx-a");
  });

  it("rejects vm system_id", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].system_id = "vm-paperless-ngx-a";
    expect(() => normalizePaperlessNgxConfig(bad)).toThrow(/paperless-ngx/);
  });

  it("resolvePaperlessNgxDeployments instance flag", () => {
    const list = resolvePaperlessNgxDeployments(baseCfg, { instance: "a" });
    expect(list[0].systemId).toBe("paperless-ngx-a");
  });

  it("instanceFlagToSystemId", () => {
    expect(instanceFlagToSystemId("a")).toBe("paperless-ngx-a");
    expect(instanceFlagToSystemId("paperless-ngx-a")).toBe("paperless-ngx-a");
  });

  it("listPaperlessNgxDeploymentSummaries", () => {
    const list = listPaperlessNgxDeploymentSummaries(baseCfg);
    expect(list[0].system_id).toBe("paperless-ngx-a");
    expect(list[0].host_port).toBe(8000);
    expect(list[0].tika_enabled).toBe(true);
  });
});
