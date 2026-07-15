import { describe, expect, it } from "vitest";
import { resolveCrowdsecDeployments } from "hdc/clump/services/crowdsec/lib/deployments.mjs";

describe("crowdsec deployments", () => {
  it("resolves crowdsec-a from deployments", () => {
    const rows = resolveCrowdsecDeployments(
      {
        schema_version: 2,
        defaults: { mode: "proxmox-lxc", crowdsec: { lapi_port: 8080 } },
        deployments: [
          {
            system_id: "crowdsec-a",
            proxmox: { host_id: "pve-b", lxc: { vmid: 561, hostname: "crowdsec-a" } },
          },
        ],
      },
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].systemId).toBe("crowdsec-a");
    expect(rows[0].crowdsec.lapi_port).toBe(8080);
  });

  it("filters by --instance a", () => {
    const rows = resolveCrowdsecDeployments(
      {
        schema_version: 2,
        defaults: { mode: "proxmox-lxc" },
        deployments: [
          {
            system_id: "crowdsec-a",
            proxmox: { host_id: "pve-b", lxc: { vmid: 561 } },
          },
          {
            system_id: "crowdsec-b",
            proxmox: { host_id: "pve-c", lxc: { vmid: 562 } },
          },
        ],
      },
      { instance: "a" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].systemId).toBe("crowdsec-a");
  });
});
