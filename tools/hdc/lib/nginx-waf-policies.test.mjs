import { describe, expect, it } from "vitest";

import {
  collectGroupPolicyPlan,
  mergePolicyDefinitions,
  migrateSitePoliciesV4,
  resolveLocationPolicyPlan,
  resolveSitePolicyPlan,
} from "../../../packages/services/nginx-waf/lib/nginx-waf-policies.mjs";

const catalog = mergePolicyDefinitions(
  {
    nginx_waf: {
      modsecurity: { enabled: true, rule_engine: "On" },
      trusted_cidrs: ["10.0.0.0/8"],
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
      ["10.0.0.0/8"],
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
                { id: "lan", cidrs: ["10.0.0.0/8"] },
                { id: "vpn", cidrs: ["10.8.0.0/24"] },
              ],
            },
          ],
        },
      ],
    };
    const locPlan = resolveLocationPolicyPlan(site, site.locations[0], 0, catalog, {});
    expect(locPlan.trusted_cidrs.unionCidrs).toEqual(["10.0.0.0/8", "10.8.0.0/24"]);
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
});
