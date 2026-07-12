import { describe, expect, it } from "vitest";
import { parseSynopkgStatus } from "../../../clumps/services/plex/lib/plex-synology.mjs";
import {
  instanceFlagToSystemId,
  listPlexDeploymentSummaries,
  normalizePlexConfig,
  resolvePlexDeployments,
} from "../../../clumps/services/plex/lib/deployments.mjs";

const baseCfg = {
  schema_version: 2,
  defaults: {
    mode: "synology-package",
    plex: {
      port: 32400,
      package_name: "PlexMediaServer",
      public_url: null,
    },
    install: { enabled: false },
  },
  deployments: [
    {
      system_id: "plex-a",
      hostname: "plex-a",
      mode: "synology-package",
      synology: { instance: "a" },
    },
  ],
};

describe("plex deployments", () => {
  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizePlexConfig(baseCfg);
    expect(deployments[0].system_id).toBe("plex-a");
    expect(deployments[0].mode).toBe("synology-package");
  });

  it("rejects vm system_id", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].system_id = "vm-plex-a";
    expect(() => normalizePlexConfig(bad)).toThrow(/plex-/);
  });

  it("requires synology.instance", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].synology = {};
    expect(() => normalizePlexConfig(bad)).toThrow(/synology.instance/);
  });

  it("rejects unsupported mode", () => {
    const bad = structuredClone(baseCfg);
    bad.deployments[0].mode = "proxmox-lxc";
    expect(() => normalizePlexConfig(bad)).toThrow(/synology-package/);
  });

  it("resolvePlexDeployments instance flag", () => {
    const list = resolvePlexDeployments(baseCfg, { instance: "a" });
    expect(list[0].systemId).toBe("plex-a");
    expect(list[0].install.enabled).toBe(false);
  });

  it("instanceFlagToSystemId", () => {
    expect(instanceFlagToSystemId("a")).toBe("plex-a");
    expect(instanceFlagToSystemId("plex-a")).toBe("plex-a");
  });

  it("listPlexDeploymentSummaries", () => {
    const list = listPlexDeploymentSummaries(baseCfg);
    expect(list[0].system_id).toBe("plex-a");
    expect(list[0].package_name).toBe("PlexMediaServer");
    expect(list[0].port).toBe(32400);
    expect(list[0].synology_instance).toBe("a");
    expect(list[0].install_enabled).toBe(false);
  });

  it("skip-install flag disables install", () => {
    const withInstall = structuredClone(baseCfg);
    withInstall.defaults.install.enabled = true;
    const list = resolvePlexDeployments(withInstall, { "skip-install": "" });
    expect(list[0].install.enabled).toBe(false);
  });
});

describe("parseSynopkgStatus", () => {
  it("detects running package", () => {
    const s = parseSynopkgStatus("PlexMediaServer is started");
    expect(s.installed).toBe(true);
    expect(s.running).toBe(true);
  });

  it("detects stopped package", () => {
    const s = parseSynopkgStatus("PlexMediaServer is stopped");
    expect(s.installed).toBe(true);
    expect(s.running).toBe(false);
  });

  it("detects missing package", () => {
    const s = parseSynopkgStatus("package PlexMediaServer not found");
    expect(s.installed).toBe(false);
  });
});
