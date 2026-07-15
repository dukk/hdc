import { describe, expect, it } from "vitest";

import { planSiteSync } from "hdc/clump/services/safeline/lib/safeline-sites-sync.mjs";

describe("safeline-sites-sync", () => {
  const configSites = [
    {
      id: "immich",
      server_names: ["immich.example.invalid"],
      ports: ["443"],
      ssl: true,
      upstreams: ["http://192.0.2.9:2283"],
      comment: "Immich",
    },
  ];

  it("plans create when live site missing", () => {
    const plan = planSiteSync(configSites, []);
    expect(plan.missing_in_live).toEqual(["immich"]);
    expect(plan.actions.find((a) => a.action === "create")?.site_id).toBe("immich");
  });

  it("plans update when live site drifts", () => {
    const live = [
      {
        id: 7,
        comment: "hdc:site:immich",
        server_names: ["immich.example.invalid"],
        ports: ["80"],
        upstreams: ["http://192.0.2.9:2283"],
        ssl: false,
      },
    ];
    const plan = planSiteSync(configSites, live);
    expect(plan.drifted).toEqual(["immich"]);
    expect(plan.actions.find((a) => a.action === "update")?.live_id).toBe(7);
  });

  it("plans delete on prune for hdc-managed extras", () => {
    const live = [
      {
        id: 1,
        comment: "hdc:site:old-app",
        server_names: ["old.example.invalid"],
        ports: ["443"],
        upstreams: ["http://192.0.2.1:80"],
      },
    ];
    const plan = planSiteSync([], live, { prune: true });
    expect(plan.actions.find((a) => a.action === "delete")?.site_id).toBe("old-app");
  });

  it("scopes to one site with siteFilter", () => {
    const multi = [
      ...configSites,
      {
        id: "n8n",
        server_names: ["n8n.example.invalid"],
        ports: ["443"],
        ssl: true,
        upstreams: ["http://192.0.2.1:5678"],
      },
    ];
    const plan = planSiteSync(multi, [], { siteFilter: "n8n" });
    expect(plan.config_count).toBe(1);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].site_id).toBe("n8n");
  });
});
