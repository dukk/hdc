import { describe, expect, it } from "vitest";

import {
  collectGroupPolicyPlan,
  mergePolicyDefinitions,
  migrateSitePoliciesV4,
  resolveLocationPolicyPlan,
  resolveSitePolicyPlan,
} from "hdc/clump/services/nginx-waf/lib/nginx-waf-policies.mjs";

const catalog = mergePolicyDefinitions(
  {
    nginx_waf: {
      modsecurity: { enabled: true, rule_engine: "On" },
      trusted_cidrs: ["192.0.2.0/8"],
      policy_definitions: {
        "api-rate": {
          type: "rate_limit",
          zone_name: "hdc_api",
          rate: "5r/s",
          burst: 10,
        },
      },
    },
  },
  null,
);

describe("nginx-waf-policies", () => {
  it("migrates waf and internal_only to policies", () => {
    const site = migrateSitePoliciesV4(
      {
        id: "app",
        host_names: ["app.example.com"],
        upstream: "http://127.0.0.1:1",
        waf: { enabled: true },
        locations: [{ path: "/", access: { policy: "internal_only", deny_status: 404 } }],
      },
      ["192.0.2.0/8"],
    );
    expect(site.policies).toContain("modsecurity-default");
    expect(site.locations[0].policies[0].type).toBe("trusted_cidrs");
  });

  it("resolves trusted_cidrs union across groups", () => {
    const site = {
      id: "app",
      host_names: ["app.example.com"],
      upstream: "http://127.0.0.1:1",
      policies: ["modsecurity-default"],
      locations: [
        {
          path: "/",
          policies: [
            {
              type: "trusted_cidrs",
              deny_status: 401,
              groups: [
                { id: "lan", cidrs: ["192.0.2.0/8"] },
                { id: "vpn", cidrs: ["10.8.0.0/24"] },
              ],
            },
          ],
        },
      ],
    };
    const locPlan = resolveLocationPolicyPlan(site, site.locations[0], 0, catalog, {});
    expect(locPlan.trusted_cidrs.unionCidrs).toEqual(["192.0.2.0/8", "10.8.0.0/24"]);
    expect(locPlan.trusted_cidrs.denyStatus).toBe(401);
  });

  it("location policy overrides site modsecurity", () => {
    const site = {
      id: "vault",
      host_names: ["vault.example.com"],
      upstream: "http://127.0.0.1:1",
      policies: ["modsecurity-default"],
      locations: [{ path: "/admin", policies: [{ type: "modsecurity", enabled: false }] }],
    };
    const sitePlan = resolveSitePolicyPlan(site, catalog, "vault");
    const locPlan = resolveLocationPolicyPlan(site, site.locations[0], 0, catalog, sitePlan);
    expect(sitePlan.modsecurity.enabled).toBe(true);
    expect(locPlan.modsecurity.enabled).toBe(false);
  });

  it("collectGroupPolicyPlan aggregates modsecurity profiles and exploit map", () => {
    const sites = [
      {
        id: "a",
        host_names: ["a.example.com"],
        upstream: "http://127.0.0.1:1",
        policies: ["modsecurity-default", "block-exploits"],
      },
    ];
    const plan = collectGroupPolicyPlan(sites, catalog);
    expect(plan.blockCommonExploits).toBe(true);
    expect(plan.modsecurityProfiles.length).toBeGreaterThan(0);
    expect(plan.usesModsecurity).toBe(true);
  });
  it("concatenates multiple rate_limit policies and collects conn_limit plus auth bearer hash", () => {
    const site = {
      id: "okf-mcp",
      host_names: ["okf.lab.jdlxp.com"],
      upstream: "http://10.0.0.26:8080",
      policies: [
        { type: "conn_limit", zone_name: "jdlxp_okf_conn", limit: 20 },
      ],
      locations: [
        {
          path: "/mcp",
          policies: [
            { type: "rate_limit", zone_name: "jdlxp_okf_mcp_ip", rate: "30r/s", burst: 60 },
            {
              type: "rate_limit",
              zone_name: "jdlxp_okf_mcp_auth",
              key_source: "auth_bearer_hash",
              rate: "20r/s",
              burst: 40,
            },
          ],
        },
      ],
    };
    const sitePlan = resolveSitePolicyPlan(site, catalog, "okf-mcp");
    const locPlan = resolveLocationPolicyPlan(site, site.locations[0], 0, catalog, sitePlan);
    expect(locPlan.rate_limits).toHaveLength(2);
    expect(locPlan.rate_limits.map((r) => r.zoneName)).toEqual([
      "jdlxp_okf_mcp_ip",
      "jdlxp_okf_mcp_auth",
    ]);
    expect(locPlan.rate_limits[1].key).toBe("$hdc_auth_bearer_hash");
    expect(locPlan.conn_limit.zoneName).toBe("jdlxp_okf_conn");
    expect(locPlan.conn_limit.limit).toBe(20);

    const plan = collectGroupPolicyPlan([site], catalog);
    expect(plan.authBearerHash).toBe(true);
    expect(plan.rateLimitZones.map((z) => z.zoneName).sort()).toEqual([
      "jdlxp_okf_mcp_auth",
      "jdlxp_okf_mcp_ip",
    ]);
    expect(plan.connLimitZones).toEqual([
      expect.objectContaining({ zoneName: "jdlxp_okf_conn", limit: 20, key: "$binary_remote_addr" }),
    ]);
  });

});
