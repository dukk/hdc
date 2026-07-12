import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUSTED_CIDRS,
  findCertPrimaryDeployment,
  findPeerDeployment,
  instanceFlagToSystemId,
  maintainSiteLists,
  normalizeNginxWafConfig,
  resolveNginxWafDeployments,
  resolveNginxWafGroups,
  resolveSiteAccessSettings,
  nginxWafGroupSettings,
} from "../../../clumps/services/nginx-waf/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 3,
  deployment_groups: [
    {
      id: "edge",
      acme: {
        provider: "lets_encrypt",
        challenge: "http-01",
        email_vault_key: "HDC_NGINX_WAF_LETS_ENCRYPT_EMAIL",
        cert_primary_system_id: "vm-nginx-waf-a",
      },
      sites: [
        {
          id: "example-app",
          host_names: ["app.hdc.example.invalid"],
          upstream: "http://192.0.2.50:8080",
          tls: { enabled: true, cert_name: "app.hdc.example.invalid" },
        },
      ],
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
    },
  ],
  defaults: {
    mode: "configure-only",
    proxmox: { qemu: { template_vmid: 9024 } },
  },
};

const legacyCfg = {
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
  defaults: { mode: "configure-only" },
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
  it("normalizes deployment_groups with defaults merge", () => {
    const { deploymentGroups } = normalizeNginxWafConfig(sampleCfg);
    expect(deploymentGroups).toHaveLength(1);
    expect(deploymentGroups[0].id).toBe("edge");
    expect(deploymentGroups[0].deployments[0].mode).toBe("configure-only");
  });

  it("migrates v2 flat config into default deployment group", () => {
    const { deploymentGroups } = normalizeNginxWafConfig(legacyCfg);
    expect(deploymentGroups).toHaveLength(1);
    expect(deploymentGroups[0].id).toBe("default");
    expect(deploymentGroups[0].sites[0].host_names).toEqual(["app.hdc.example.invalid"]);
  });

  it("rejects duplicate system_id across groups", () => {
    expect(() =>
      normalizeNginxWafConfig({
        schema_version: 3,
        deployment_groups: [
          {
            id: "a",
            deployments: [{ system_id: "vm-nginx-waf-a", role: "cert-primary" }],
          },
          {
            id: "b",
            deployments: [{ system_id: "vm-nginx-waf-a", role: "cert-primary" }],
          },
        ],
      }),
    ).toThrow(/duplicate system_id/);
  });

  it("requires exactly one cert-primary per group", () => {
    expect(() =>
      normalizeNginxWafConfig({
        schema_version: 3,
        deployment_groups: [
          {
            id: "edge",
            deployments: [
              { system_id: "vm-nginx-waf-a", role: "peer" },
              { system_id: "vm-nginx-waf-b", role: "peer" },
            ],
          },
        ],
      }),
    ).toThrow(/cert-primary/);
  });

  it("maps --instance b to vm-nginx-waf-b", () => {
    expect(instanceFlagToSystemId("b")).toBe("vm-nginx-waf-b");
    const one = resolveNginxWafDeployments(sampleCfg, { instance: "b" });
    expect(one).toHaveLength(1);
    expect(one[0].systemId).toBe("vm-nginx-waf-b");
    expect(one[0].groupId).toBe("edge");
  });

  it("filters by --group", () => {
    const groups = resolveNginxWafGroups(sampleCfg, { group: "edge" });
    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toBe("edge");
    expect(groups[0].deployments).toHaveLength(2);
  });

  it("returns all deployments cert-primary first when no filter", () => {
    const all = resolveNginxWafDeployments(sampleCfg, {});
    expect(all.map((d) => d.systemId)).toEqual(["vm-nginx-waf-a", "vm-nginx-waf-b"]);
  });

  it("finds cert-primary and peer within group", () => {
    const ctx = resolveNginxWafGroups(sampleCfg, {})[0];
    const primary = findCertPrimaryDeployment(ctx.deployments, ctx.global.certPrimarySystemId);
    const peer = findPeerDeployment(ctx.deployments, primary);
    expect(primary.systemId).toBe("vm-nginx-waf-a");
    expect(peer?.systemId).toBe("vm-nginx-waf-b");
  });

  it("parses acme challenge dns-01", () => {
    const normalized = normalizeNginxWafConfig({
      ...sampleCfg,
      deployment_groups: [
        {
          ...sampleCfg.deployment_groups[0],
          acme: { ...sampleCfg.deployment_groups[0].acme, challenge: "dns-01" },
        },
      ],
    });
    const global = nginxWafGroupSettings(normalized, normalized.deploymentGroups[0]);
    expect(global.challenge).toBe("dns-01");
  });

  it("defaults rule_engine to DetectionOnly when acme staging", () => {
    const normalized = normalizeNginxWafConfig({
      ...sampleCfg,
      deployment_groups: [
        {
          ...sampleCfg.deployment_groups[0],
          acme: { ...sampleCfg.deployment_groups[0].acme, staging: true },
        },
      ],
    });
    const global = nginxWafGroupSettings(normalized, normalized.deploymentGroups[0]);
    expect(global.modsecurityRuleEngine).toBe("DetectionOnly");
  });

  it("defaults trusted_cidrs to RFC1918-style ranges", () => {
    const normalized = normalizeNginxWafConfig(sampleCfg);
    const global = nginxWafGroupSettings(normalized, normalized.deploymentGroups[0]);
    expect(global.trustedCidrs).toEqual(DEFAULT_TRUSTED_CIDRS);
    expect(global.cloudflareIpv4).toBe(true);
    expect(global.emailVaultKey).toBe("HDC_NGINX_WAF_LETS_ENCRYPT_EMAIL");
  });

  it("resolveSiteAccessSettings inherits defaults.nginx_waf.client_ip", () => {
    const normalized = normalizeNginxWafConfig({
      ...sampleCfg,
      defaults: {
        ...sampleCfg.defaults,
        nginx_waf: { client_ip: "cloudflare" },
      },
    });
    const global = nginxWafGroupSettings(normalized, normalized.deploymentGroups[0]);
    const access = resolveSiteAccessSettings({ id: "example-app" }, global);
    expect(access.clientIp).toBe("cloudflare");
  });

  it("rejects duplicate host_names within a group", () => {
    expect(() =>
      normalizeNginxWafConfig({
        schema_version: 3,
        deployment_groups: [
          {
            id: "edge",
            deployments: [{ system_id: "vm-nginx-waf-a", role: "cert-primary" }],
            sites: [
              {
                id: "draw",
                host_names: ["draw.example.invalid"],
                upstream: "http://192.0.2.155:8080",
              },
              {
                id: "vaultwarden",
                host_names: ["vault.example.invalid", "draw.example.invalid"],
                upstream: "http://192.0.2.123:80",
              },
            ],
          },
        ],
      }),
    ).toThrow(/draw\.example\.invalid/);
  });

  it("maintainSiteLists keeps allSites for vhost push when --site is set", () => {
    const cfg = {
      ...sampleCfg,
      deployment_groups: [
        {
          ...sampleCfg.deployment_groups[0],
          sites: [
            sampleCfg.deployment_groups[0].sites[0],
            {
              id: "other",
              host_names: ["other.hdc.example.invalid"],
              upstream: "http://192.0.2.51:8080",
            },
          ],
        },
      ],
    };
    const normalized = normalizeNginxWafConfig(cfg);
    const global = nginxWafGroupSettings(normalized, normalized.deploymentGroups[0]);
    const { allSites, certSites, partialSiteUpdate } = maintainSiteLists(
      global,
      cfg,
      "example-app",
      "edge",
    );
    expect(partialSiteUpdate).toBe(true);
    expect(allSites).toHaveLength(2);
    expect(certSites).toHaveLength(1);
    expect(certSites[0].id).toBe("example-app");
  });

  it("migrates v3 waf fields to policies on normalize", () => {
    const { deploymentGroups } = normalizeNginxWafConfig({
      schema_version: 3,
      deployment_groups: [
        {
          id: "edge",
          deployments: [{ system_id: "vm-nginx-waf-a", role: "cert-primary" }],
          sites: [
            {
              id: "app",
              host_names: ["app.example.com"],
              upstream: "http://127.0.0.1:1",
              waf: { enabled: true },
              locations: [
                { path: "/", access: { policy: "internal_only", deny_status: 404 } },
              ],
            },
          ],
        },
      ],
    });
    const site = deploymentGroups[0].sites[0];
    expect(site.policies).toContain("modsecurity-default");
    expect(site.locations[0].policies?.[0]).toMatchObject({ type: "trusted_cidrs" });
  });

  it("accepts schema_version 4 with explicit policies", () => {
    const { deploymentGroups } = normalizeNginxWafConfig({
      schema_version: 4,
      deployment_groups: [
        {
          id: "edge",
          deployments: [{ system_id: "vm-nginx-waf-a", role: "cert-primary" }],
          sites: [
            {
              id: "app",
              host_names: ["app.example.com"],
              upstream: "http://127.0.0.1:1",
              policies: ["modsecurity-default", "block-exploits"],
            },
          ],
        },
      ],
    });
    expect(deploymentGroups[0].policyDefinitions["modsecurity-default"]).toBeDefined();
    expect(deploymentGroups[0].sites[0].policies).toEqual([
      "modsecurity-default",
      "block-exploits",
    ]);
  });
});
