import { describe, expect, it } from "vitest";
import {
  findCertPrimaryDeployment,
  findPeerDeployment,
  instanceFlagToSystemId,
  nginxWafGlobalSettings,
  normalizeNginxWafConfig,
  resolveNginxWafDeployments,
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
});
