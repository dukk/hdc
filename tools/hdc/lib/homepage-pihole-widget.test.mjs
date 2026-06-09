import { describe, expect, it } from "vitest";

import {
  ipFromIpConfig,
  piholeInstanceEnvSlug,
  piholeWidgetEnabled,
  piholeWidgetSettings,
  resolvePiholeWidgetInstances,
} from "../../../packages/services/homepage/lib/homepage-pihole-widget.mjs";

describe("homepage pihole widget", () => {
  it("ipFromIpConfig extracts address from static ip_config", () => {
    expect(ipFromIpConfig("10.0.0.4/24,gw=10.0.0.1")).toBe("10.0.0.4");
    expect(ipFromIpConfig("10.0.0.5/24")).toBe("10.0.0.5");
  });

  it("ipFromIpConfig rejects dhcp", () => {
    expect(ipFromIpConfig("dhcp")).toBeNull();
    expect(ipFromIpConfig("")).toBeNull();
  });

  it("piholeInstanceEnvSlug uppercases letters", () => {
    expect(piholeInstanceEnvSlug("a")).toBe("A");
    expect(piholeInstanceEnvSlug("b")).toBe("B");
  });

  it("piholeWidgetEnabled respects enabled flag", () => {
    expect(piholeWidgetEnabled({ pihole_widget: { enabled: true } })).toBe(true);
    expect(piholeWidgetEnabled({ pihole_widget: { enabled: false } })).toBe(false);
    expect(piholeWidgetEnabled({})).toBe(false);
  });

  it("piholeWidgetSettings parses instances and version", () => {
    expect(
      piholeWidgetSettings({
        pihole_widget: { enabled: true, version: 6, instances: ["a", "pi-hole-b"] },
      }),
    ).toEqual({ version: 6, instanceLetters: ["a", "b"] });
  });

  it("resolvePiholeWidgetInstances builds env-ready rows", () => {
    const cfg = {
      schema_version: 2,
      defaults: {
        pihole: { webpassword: "secret-admin" },
      },
      deployments: [
        {
          system_id: "pi-hole-a",
          proxmox: { host_id: "pve-b", lxc: { vmid: 110, ip_config: "10.0.0.4/24,gw=10.0.0.1" } },
        },
        {
          system_id: "pi-hole-b",
          proxmox: { host_id: "pve-c", lxc: { vmid: 112, ip_config: "10.0.0.5/24,gw=10.0.0.1" } },
        },
      ],
    };
    const all = resolvePiholeWidgetInstances(cfg);
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual({
      letter: "a",
      systemId: "pi-hole-a",
      url: "http://10.0.0.4",
      key: "secret-admin",
    });

    const filtered = resolvePiholeWidgetInstances(cfg, ["b"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].systemId).toBe("pi-hole-b");
  });

  it("resolvePiholeWidgetInstances throws without webpassword", () => {
    expect(() =>
      resolvePiholeWidgetInstances({
        schema_version: 2,
        defaults: { pihole: {} },
        deployments: [
          {
            system_id: "pi-hole-a",
            proxmox: { host_id: "pve-b", lxc: { vmid: 110, ip_config: "10.0.0.4/24" } },
          },
        ],
      }),
    ).toThrow(/webpassword required/);
  });
});
