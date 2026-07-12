import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listGitlabDeploymentSummaries,
  normalizeGitlabConfig,
  resolveGitlabDeployments,
} from "../../../clumps/services/gitlab/lib/deployments.mjs";

const baseCfg = {
  schema_version: 2,
  defaults: {
    mode: "proxmox-lxc",
    gitlab: {
      image_tag: "17.5.5-ce.0",
      external_url: "https://gitlab.example.invalid",
    },
  },
  deployments: [
    {
      system_id: "gitlab-a",
      proxmox: { host_id: "hypervisor-a", lxc: { vmid: 488 } },
    },
  ],
};

describe("gitlab deployments", () => {
  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeGitlabConfig(baseCfg);
    expect(deployments[0].system_id).toBe("gitlab-a");
  });

  it("rejects vm system_id", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].system_id = "vm-gitlab-a";
    expect(() => normalizeGitlabConfig(bad)).toThrow(/gitlab/);
  });

  it("requires https external_url", () => {
    const bad = structuredClone(baseCfg);
    bad.defaults.gitlab.external_url = "http://gitlab.example.invalid";
    expect(() => normalizeGitlabConfig(bad)).toThrow(/https/);
  });

  it("resolveGitlabDeployments instance flag", () => {
    const list = resolveGitlabDeployments(baseCfg, { instance: "a" });
    expect(list[0].systemId).toBe("gitlab-a");
  });

  it("instanceFlagToSystemId", () => {
    expect(instanceFlagToSystemId("a")).toBe("gitlab-a");
    expect(instanceFlagToSystemId("gitlab-a")).toBe("gitlab-a");
  });

  it("listGitlabDeploymentSummaries", () => {
    const list = listGitlabDeploymentSummaries(baseCfg);
    expect(list[0].system_id).toBe("gitlab-a");
    expect(list[0].external_url).toBe("https://gitlab.example.invalid");
    expect(list[0].host_port).toBe(80);
    expect(list[0].ssh_host_port).toBe(2222);
    expect(list[0].signups_enabled).toBe(false);
  });
});
