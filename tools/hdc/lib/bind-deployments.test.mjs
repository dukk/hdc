import { describe, expect, it } from "vitest";
import {
  bindGlobalSettings,
  normalizeBindConfig,
  resolveBindDeployments,
} from "../../../packages/services/bind/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  zones: [
    { id: "hdc.example.invalid", zone_type: "forward", records: [] },
    { id: "2.0.192.in-addr.arpa", zone_type: "reverse", subnet: "192.0.2.0/24", records: [] },
  ],
  bind: { primary_ip: "192.0.2.2", secondary_ip: "192.0.2.3" },
  defaults: { mode: "configure-only" },
  deployments: [
    { system_id: "vm-dns-a", role: "primary", mode: "configure-only", configure: { ssh: { host: "192.0.2.2" } } },
    { system_id: "vm-dns-b", role: "secondary", mode: "configure-only", configure: { ssh: { host: "192.0.2.3" } } },
  ],
};

describe("bind-deployments", () => {
  it("normalizes config with exactly one primary", () => {
    const n = normalizeBindConfig(sampleCfg);
    expect(n.zones).toHaveLength(2);
    expect(n.deployments).toHaveLength(2);
  });

  it("rejects missing primary", () => {
    expect(() =>
      normalizeBindConfig({
        ...sampleCfg,
        deployments: [{ system_id: "vm-dns-b", role: "secondary", mode: "configure-only" }],
      }),
    ).toThrow(/exactly one primary/);
  });

  it("orders primary first when deploying all", () => {
    const list = resolveBindDeployments(sampleCfg, {});
    expect(list[0].role).toBe("primary");
    expect(list[1].role).toBe("secondary");
  });

  it("bindGlobalSettings reads IPs from bind block", () => {
    const g = bindGlobalSettings(normalizeBindConfig(sampleCfg));
    expect(g.primaryIp).toBe("192.0.2.2");
    expect(g.secondaryIp).toBe("192.0.2.3");
    expect(g.zoneIds).toEqual(["hdc.example.invalid", "2.0.192.in-addr.arpa"]);
    expect(Object.keys(g.zoneDefinitions)).toHaveLength(2);
  });
});
