import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUSTED_CIDRS,
  findCertPrimaryDeployment,
  findPeerDeployment,
  instanceFlagToSystemId,
  nginxWafGlobalSettings,
  normalizeNginxWafConfig,
  resolveNginxWafDeployments,
  resolveSiteAccessSettings,
} from "../../../packages/services/nginx-waf/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  letsencrypt: {
    challenge: "http-01",
    cert_primary_system_id: "vm-nginx-waf-a",
  },
  sites: [
    {
      id: "example-app",
      server_names: ["app.hdc.example.invalid"],
      upstream: "http://192.0.2.50:8080",
      tls: { enabled: true, cert_name: "app.hdc.example.invalid" },
    },
  ],
  defaults: {
    mode: "configure-only",
    proxmox: { qemu: { template_vmid: 9024 } },
  },
  deployments: [
    {
      system_id: "vm-nginx-waf-a",
      role: "cert-primary",
      configure: { ssh: { host: "192.0.2.20" } },
    },
    {
      system_id: "vm-nginx-waf-b",
      role: "peer",
      configure: { ssh: { host: "192.0.2.21" } },
    },
  ],
};

describe("nginx-waf deployments", () => {
  it("normalizes deployments[] with defaults merge", () => {
    const { deployments } = normalizeNginxWafConfig(sampleCfg);
    expect(deployments).toHaveLength(2);
    expect(deployments[0].system_id).toBe("vm-nginx-waf-a");
    expect(deployments[0].mode).toBe("configure-only");
  });

  it("rejects duplicate system_id", () => {
    expect(() =>
      normalizeNginxWafConfig({
        deployments: [
          { system_id: "vm-nginx-waf-a", role: "cert-primary" },
          { system_id: "vm-nginx-waf-a", role: "peer" },
        ],
      }),
    ).toThrow(/duplicate system_id/);
  });

  it("rejects invalid system_id pattern", () => {
    expect(() =>
      normalizeNginxWafConfig({
        deployments: [{ system_id: "vm-waf-a", role: "cert-primary" }],
      }),
    ).toThrow(/vm-nginx-waf/);
  });

  it("requires exactly one cert-primary", () => {
    expect(() =>
      normalizeNginxWafConfig({
        deployments: [
          { system_id: "vm-nginx-waf-a", role: "peer" },
          { system_id: "vm-nginx-waf-b", role: "peer" },
        ],
      }),
    ).toThrow(/cert-primary/);
  });

  it("maps --instance b to vm-nginx-waf-b", () => {
    expect(instanceFlagToSystemId("b")).toBe("vm-nginx-waf-b");
    const one = resolveNginxWafDeployments(sampleCfg, { instance: "b" });
    expect(one).toHaveLength(1);
    expect(one[0].systemId).toBe("vm-nginx-waf-b");
    expect(one[0].role).toBe("peer");
  });

  it("returns all deployments cert-primary first when no filter", () => {
    const all = resolveNginxWafDeployments(sampleCfg, {});
    expect(all.map((d) => d.systemId)).toEqual(["vm-nginx-waf-a", "vm-nginx-waf-b"]);
  });

  it("finds cert-primary and peer", () => {
    const all = resolveNginxWafDeployments(sampleCfg, {});
    const global = nginxWafGlobalSettings(normalizeNginxWafConfig(sampleCfg));
    const primary = findCertPrimaryDeployment(all, global.certPrimarySystemId);
    const peer = findPeerDeployment(all, primary);
    expect(primary.systemId).toBe("vm-nginx-waf-a");
    expect(peer.systemId).toBe("vm-nginx-waf-b");
  });

  it("parses letsencrypt challenge dns-01", () => {
    const global = nginxWafGlobalSettings(
      normalizeNginxWafConfig({
        ...sampleCfg,
        letsencrypt: { ...sampleCfg.letsencrypt, challenge: "dns-01" },
      }),
    );
    expect(global.challenge).toBe("dns-01");
  });

  it("defaults rule_engine to DetectionOnly when letsencrypt staging", () => {
    const global = nginxWafGlobalSettings(
      normalizeNginxWafConfig({
        ...sampleCfg,
        letsencrypt: { ...sampleCfg.letsencrypt, staging: true },
      }),
    );
    expect(global.modsecurityRuleEngine).toBe("DetectionOnly");
  });

  it("uses explicit modsecurity rule_engine override", () => {
    const global = nginxWafGlobalSettings(
      normalizeNginxWafConfig({
        ...sampleCfg,
        defaults: {
          ...sampleCfg.defaults,
          nginx_waf: {
            modsecurity: { enabled: true, rule_engine: "On" },
          },
        },
        letsencrypt: { ...sampleCfg.letsencrypt, staging: true },
      }),
    );
    expect(global.modsecurityRuleEngine).toBe("On");
  });

  it("defaults trusted_cidrs to RFC1918-style ranges", () => {
    const global = nginxWafGlobalSettings(normalizeNginxWafConfig(sampleCfg));
    expect(global.trustedCidrs).toEqual(DEFAULT_TRUSTED_CIDRS);
    expect(global.cloudflareIpv4).toBe(true);
  });

  it("resolveSiteAccessSettings inherits defaults.nginx_waf.client_ip", () => {
    const normalized = normalizeNginxWafConfig({
      ...sampleCfg,
      defaults: {
        ...sampleCfg.defaults,
        nginx_waf: { client_ip: "cloudflare" },
      },
    });
    const global = nginxWafGlobalSettings(normalized);
    const access = resolveSiteAccessSettings({ id: "example-app" }, global);
    expect(access.clientIp).toBe("cloudflare");
    const override = resolveSiteAccessSettings(
      { id: "example-app", client_ip: "remote_addr" },
      global,
    );
    expect(override.clientIp).toBe("remote_addr");
  });

  it("resolveSiteAccessSettings uses site trusted_cidrs override", () => {
    const normalized = normalizeNginxWafConfig({
      ...sampleCfg,
      defaults: {
        ...sampleCfg.defaults,
        nginx_waf: { trusted_cidrs: ["10.0.0.0/8"] },
      },
    });
    const global = nginxWafGlobalSettings(normalized);
    const site = {
      id: "example-app",
      trusted_cidrs: ["192.168.1.0/24"],
      client_ip: "cloudflare",
    };
    const access = resolveSiteAccessSettings(site, global);
    expect(access.trustedCidrs).toEqual(["192.168.1.0/24"]);
    expect(access.clientIp).toBe("cloudflare");
  });
});
