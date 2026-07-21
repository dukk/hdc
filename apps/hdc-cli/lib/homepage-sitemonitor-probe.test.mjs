import { describe, expect, it } from "vitest";

import {
  enumerateHomepageMonitorTargets,
  parseHomepageMonitorTargetsFromYaml,
} from "hdc/clump/services/homepage/lib/homepage-sitemonitor-probe.mjs";

describe("homepage-sitemonitor-probe", () => {
  it("parseHomepageMonitorTargetsFromYaml extracts siteMonitor and ping", () => {
    const yaml = `- Personal:
    - Immich:
        siteMonitor: https://immich.example.invalid
        ping: 10.0.0.10
`;
    const targets = parseHomepageMonitorTargetsFromYaml(yaml);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      group: "Personal",
      name: "Immich",
      kind: "siteMonitor",
      target: "https://immich.example.invalid",
    });
    expect(targets[1]).toMatchObject({
      group: "Personal",
      name: "Immich",
      kind: "ping",
      target: "10.0.0.10",
    });
  });

  it("enumerateHomepageMonitorTargets skips services without monitors", () => {
    const targets = enumerateHomepageMonitorTargets([
      {
        name: "Infra",
        services: [{ name: "No probe" }, { name: "Pi-hole", ping: "10.0.0.2" }],
      },
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe("Pi-hole");
  });
});
