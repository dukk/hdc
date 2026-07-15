import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listZabbixDeploymentSummaries,
  normalizeZabbixConfig,
  resolveZabbixDeployments,
  zabbixDatabase,
  zabbixWebHttpPort,
} from "hdc/clump/services/zabbix/lib/deployments.mjs";

describe("zabbix deployments", () => {
  const v2Lxc = {
    schema_version: 2,
    defaults: { mode: "proxmox-lxc", zabbix: { release: "7.0", database: "pgsql" } },
    deployments: [
      {
        system_id: "zabbix-a",
        proxmox: { host_id: "hypervisor-a", lxc: { vmid: 580 } },
      },
    ],
  };

  const v2Qemu = {
    schema_version: 2,
    defaults: { mode: "proxmox-qemu", zabbix: { release: "7.0" } },
    deployments: [
      {
        system_id: "vm-zabbix-a",
        proxmox: {
          host_id: "pve-b",
          qemu: { vmid: 581, ip: "192.0.2.203/24", template_vmid: 9022 },
        },
        configure: { ssh: { host: "192.0.2.203" } },
      },
    ],
  };

  it("normalizes schema v2 LXC deployments", () => {
    const { deployments } = normalizeZabbixConfig(v2Lxc);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].system_id).toBe("zabbix-a");
  });

  it("normalizes schema v2 QEMU deployments", () => {
    const { deployments } = normalizeZabbixConfig(v2Qemu);
    expect(deployments[0].system_id).toBe("vm-zabbix-a");
  });

  it("resolves single deployment", () => {
    const list = resolveZabbixDeployments(v2Lxc, {});
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("zabbix-a");
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("a")).toBe("zabbix-a");
    expect(instanceFlagToSystemId("a", "proxmox-qemu")).toBe("vm-zabbix-a");
    expect(instanceFlagToSystemId("zabbix-a")).toBe("zabbix-a");
    expect(instanceFlagToSystemId("vm-zabbix-a")).toBe("vm-zabbix-a");
  });

  it("lists deployment summaries", () => {
    const list = listZabbixDeploymentSummaries(v2Lxc);
    expect(list[0].system_id).toBe("zabbix-a");
    expect(list[0].release).toBe("7.0");
    expect(list[0].database).toBe("pgsql");
    expect(list[0].web_http_port).toBe(80);
  });

  it("rejects invalid LXC system_id", () => {
    const bad = structuredClone(v2Lxc);
    bad.deployments[0].system_id = "vm-zabbix-a";
    expect(() => normalizeZabbixConfig(bad)).toThrow(/zabbix/);
  });

  it("zabbixDatabase defaults to pgsql", () => {
    expect(zabbixDatabase({})).toBe("pgsql");
    expect(zabbixDatabase({ database: "mysql" })).toBe("mysql");
  });

  it("zabbixWebHttpPort defaults to 80", () => {
    expect(zabbixWebHttpPort({})).toBe(80);
    expect(zabbixWebHttpPort({ web_http_port: 8080 })).toBe(8080);
  });
});
