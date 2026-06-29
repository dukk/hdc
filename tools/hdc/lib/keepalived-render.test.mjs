import { describe, expect, it } from "vitest";
import {
  buildDrRealServerCommands,
  buildDirectorSysctlCommands,
  buildNatRealServerVerifyCommand,
  renderKeepalivedConf,
} from "../../../packages/services/keepalived/lib/keepalived-render.mjs";
import {
  finalizeDirectorDeployment,
  keepalivedGlobalSettings,
  normalizeKeepalivedConfig,
} from "../../../packages/services/keepalived/lib/deployments.mjs";

const exampleCfg = {
  schema_version: 2,
  keepalived: {
    auth_pass_vault_key: "HDC_KEEPALIVED_AUTH_PASS",
    router_id: "HDC_LVS",
  },
  vrrp_instances: [
    {
      id: "wan-vip",
      virtual_router_id: 51,
      interface: "eth0",
      virtual_ipaddress: ["192.0.2.50/24"],
      track_scripts: [
        {
          id: "chk_nginx",
          script: "systemctl is-active --quiet nginx",
          interval: 2,
          weight: -20,
        },
      ],
    },
  ],
  virtual_servers: [
    {
      id: "https",
      vrrp_instance_id: "wan-vip",
      vip: "192.0.2.50",
      port: 443,
      protocol: "TCP",
      lb_kind: "NAT",
      lb_algo: "rr",
      real_servers: [
        { address: "192.0.2.40", port: 443, weight: 1, system_id: "vm-nginx-waf-a" },
        { address: "192.0.2.41", port: 443, weight: 1, system_id: "vm-nginx-waf-b" },
      ],
    },
  ],
  deployments: [
    {
      deployment_kind: "director",
      system_id: "vm-keepalived-a",
      role: "master",
      state: "MASTER",
      priority: 150,
      mode: "configure-only",
      vrrp_instance_ids: ["wan-vip"],
      configure: { ssh: { host: "192.0.2.45" } },
    },
    {
      deployment_kind: "director",
      system_id: "vm-keepalived-b",
      role: "backup",
      state: "BACKUP",
      priority: 100,
      mode: "configure-only",
      vrrp_instance_ids: ["wan-vip"],
      configure: { ssh: { host: "192.0.2.46" } },
    },
    {
      deployment_kind: "real_server",
      system_id: "vm-nginx-waf-a",
      mode: "configure-only",
      lb_kind: "NAT",
      virtual_server_ids: ["https"],
      configure: { ssh: { host: "192.0.2.40" } },
    },
    {
      deployment_kind: "real_server",
      system_id: "vm-nginx-waf-b",
      mode: "configure-only",
      lb_kind: "NAT",
      virtual_server_ids: ["https"],
      configure: { ssh: { host: "192.0.2.41" } },
    },
  ],
};

describe("keepalived-render", () => {
  const normalized = normalizeKeepalivedConfig(exampleCfg);
  const global = keepalivedGlobalSettings(normalized);
  const master = finalizeDirectorDeployment(
    normalized.deployments.find((d) => d.state === "MASTER"),
    false,
  );
  const backup = finalizeDirectorDeployment(
    normalized.deployments.find((d) => d.state === "BACKUP"),
    false,
  );

  it("renders MASTER vrrp_instance with track_script and NAT virtual_server", () => {
    const conf = renderKeepalivedConf({
      global,
      director: master,
      vrrpInstances: normalized.vrrpInstances,
      virtualServers: normalized.virtualServers,
      authPass: "s3cret12",
    });
    expect(conf).toContain("router_id HDC_LVS");
    expect(conf).toContain("vrrp_script chk_nginx");
    expect(conf).toContain("state MASTER");
    expect(conf).toContain("priority 150");
    expect(conf).toContain("auth_pass s3cret12");
    expect(conf).toContain("virtual_server 192.0.2.50 443");
    expect(conf).toContain("lb_kind NAT");
    expect(conf).toContain("real_server 192.0.2.40 443");
    expect(conf).toContain("TCP_CHECK");
  });

  it("renders BACKUP director with lower priority", () => {
    const conf = renderKeepalivedConf({
      global,
      director: backup,
      vrrpInstances: normalized.vrrpInstances,
      virtualServers: normalized.virtualServers,
      authPass: "s3cret12",
    });
    expect(conf).toContain("state BACKUP");
    expect(conf).toContain("priority 100");
    expect(conf).not.toContain("state MASTER");
  });

  it("buildDrRealServerCommands configures lo VIP and sysctl", () => {
    const cmd = buildDrRealServerCommands("192.0.2.50/32");
    expect(cmd).toContain("arp_ignore");
    expect(cmd).toContain("ip addr add '192.0.2.50/32' dev lo");
  });

  it("buildDirectorSysctlCommands enables ip_forward for NAT", () => {
    expect(buildDirectorSysctlCommands(true)).toContain("net.ipv4.ip_forward");
    expect(buildDirectorSysctlCommands(false)).toBe("");
  });

  it("buildNatRealServerVerifyCommand checks default route", () => {
    const cmd = buildNatRealServerVerifyCommand("192.0.2.50");
    expect(cmd).toContain("ip route show default");
    expect(cmd).toContain("192.0.2.50");
  });
});

describe("keepalived-deployments", () => {
  it("normalizeKeepalivedConfig validates director pair and real servers", () => {
    const n = normalizeKeepalivedConfig(exampleCfg);
    expect(n.vrrpInstances).toHaveLength(1);
    expect(n.virtualServers).toHaveLength(1);
    expect(n.deployments).toHaveLength(4);
  });

  it("rejects missing MASTER director", () => {
    const bad = structuredClone(exampleCfg);
    bad.deployments[0].state = "BACKUP";
    bad.deployments[1].state = "BACKUP";
    expect(() => normalizeKeepalivedConfig(bad)).toThrow(/MASTER/);
  });
});
