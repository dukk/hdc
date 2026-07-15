import { describe, expect, it } from "vitest";

import {
  diskstationInstanceEnvSlug,
  diskstationWidgetEnabled,
  diskstationWidgetSettings,
  resolveDiskstationWidgetInstances,
} from "hdc/clump/services/homepage/lib/homepage-diskstation-widget.mjs";

describe("homepage diskstation widget", () => {
  it("diskstationInstanceEnvSlug uppercases letters", () => {
    expect(diskstationInstanceEnvSlug("a")).toBe("A");
    expect(diskstationInstanceEnvSlug("b")).toBe("B");
  });

  it("diskstationWidgetEnabled respects enabled flag", () => {
    expect(diskstationWidgetEnabled({ diskstation_widget: { enabled: true } })).toBe(true);
    expect(diskstationWidgetEnabled({ diskstation_widget: { enabled: false } })).toBe(false);
    expect(diskstationWidgetEnabled({})).toBe(false);
  });

  it("diskstationWidgetSettings parses instances and port", () => {
    expect(
      diskstationWidgetSettings({
        diskstation_widget: { enabled: true, instances: ["a", "b"], port: 5000 },
      }),
    ).toEqual({
      instanceLetters: ["a", "b"],
      port: 5000,
      usernames: {},
    });
  });

  it("resolveDiskstationWidgetInstances builds env-ready rows", () => {
    const cfg = {
      schema_version: 1,
      deployments: [
        {
          instance: "a",
          system_id: "nas-a",
          ssh: { host: "10.0.0.9" },
        },
        {
          instance: "b",
          system_id: "nas-b",
          ssh: { host: "10.0.0.10", user: "dukk" },
        },
      ],
    };
    const all = resolveDiskstationWidgetInstances(cfg, ["a", "b"], 5000);
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual({
      letter: "a",
      systemId: "nas-a",
      url: "http://10.0.0.9:5000",
      username: "homepage-stats",
      passwordVaultKey: "HDC_HOMEPAGE_SYNOLOGY_NAS_A_PASSWORD",
    });
    expect(all[1].url).toBe("http://10.0.0.10:5000");
  });
});
