import { describe, it, expect } from "vitest";

import {
  listNagiosDeploymentSummaries,
  normalizeNagiosConfig,
  resolveNagiosDeployments,
} from "../../packages/services/nagios/lib/deployments.mjs";

const validCfg = {
  schema_version: 2,
  bind_config_path: "packages/services/bind/config.json",
  defaults: {
    mode: "proxmox-lxc",
    proxmox: {
      lxc: {
        vmid: 0,
        ip_config: "10.0.0.100/24,gw=10.0.0.1",
      },
    },
  },
  deployments: [
    {
      system_id: "nagios-a",
      proxmox: {
        host_id: "pve-b",
        lxc: { vmid: 150, ip_config: "10.0.0.100/24,gw=10.0.0.1" },
      },
    },
    {
      system_id: "nagios-b",
      proxmox: {
        host_id: "pve-c",
        lxc: { vmid: 151, ip_config: "10.0.0.101/24,gw=10.0.0.1" },
      },
    },
  ],
};

describe("nagios deployments", () => {
  it("rejects schema_version 1", () => {
    expect(() =>
      normalizeNagiosConfig({
        schema_version: 1,
        central_cluster_document: {},
        monitored_systems: [],
      }),
    ).toThrow(/schema_version must be 2/);
  });

  it("requires bind_config_path and deployments", () => {
    expect(() => normalizeNagiosConfig({ schema_version: 2 })).toThrow(/bind_config_path/);
    expect(() =>
      normalizeNagiosConfig({ schema_version: 2, bind_config_path: "packages/services/bind/config.json" }),
    ).toThrow(/deployments/);
  });

  it("normalizes valid v2 config", () => {
    const norm = normalizeNagiosConfig(validCfg);
    expect(norm.schemaVersion).toBe(2);
    expect(norm.deployments).toHaveLength(2);
    expect(norm.bindConfigPath).toBe("packages/services/bind/config.json");
  });

  it("lists deployment summaries", () => {
    const summaries = listNagiosDeploymentSummaries(validCfg);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].system_id).toBe("nagios-a");
    expect(summaries[0].host_id).toBe("pve-b");
    expect(summaries[0].vmid).toBe(150);
  });

  it("resolves all deployments when no instance flag", () => {
    const selected = resolveNagiosDeployments(validCfg, {});
    expect(selected).toHaveLength(2);
  });

  it("resolves single instance by --instance a", () => {
    const selected = resolveNagiosDeployments(validCfg, { instance: "a" });
    expect(selected).toHaveLength(1);
    expect(selected[0].systemId).toBe("nagios-a");
  });
});
