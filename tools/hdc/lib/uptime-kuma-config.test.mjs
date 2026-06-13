import { describe, expect, it } from "vitest";

import {
  monitorHasDrift,
  monitorToSocketPayload,
  shouldIgnoreTlsForUrl,
  slugifyMonitorId,
} from "../../../packages/services/uptime-kuma/lib/uptime-kuma-config.mjs";
import {
  homepageServiceToMonitor,
  monitorsFromHomepageServicesYaml,
  serviceNameToMonitorId,
} from "../../../packages/services/uptime-kuma/lib/uptime-kuma-homepage-import.mjs";

describe("uptime-kuma config", () => {
  it("slugifyMonitorId normalizes service names", () => {
    expect(slugifyMonitorId("Pi-hole A")).toBe("pi-hole-a");
    expect(serviceNameToMonitorId("Proxmox B")).toBe("proxmox-b");
  });

  it("shouldIgnoreTlsForUrl detects Proxmox HTTPS", () => {
    expect(shouldIgnoreTlsForUrl("https://10.0.0.11:8006")).toBe(true);
    expect(shouldIgnoreTlsForUrl("http://10.0.0.4/admin")).toBe(false);
  });

  it("monitorHasDrift compares managed fields", () => {
    const cfg = {
      id: "pi-hole-a",
      uptime_kuma_id: 1,
      name: "Pi-hole A",
      type: "http",
      url: "http://10.0.0.4/admin",
      hostname: null,
      group: "Infrastructure",
      interval: 60,
      ignore_tls: false,
      managed: true,
      notes: null,
    };
    expect(monitorHasDrift(cfg, { ...cfg })).toBe(false);
    expect(monitorHasDrift(cfg, { ...cfg, url: "http://10.0.0.5/admin" })).toBe(true);
  });

  it("monitorToSocketPayload builds http monitor", () => {
    const payload = monitorToSocketPayload({
      id: "pi-hole-a",
      uptime_kuma_id: null,
      name: "Pi-hole A",
      type: "http",
      url: "http://10.0.0.4/admin",
      hostname: null,
      group: "Infrastructure",
      interval: 60,
      ignore_tls: false,
      managed: true,
      notes: null,
    });
    expect(payload.type).toBe("http");
    expect(payload.url).toBe("http://10.0.0.4/admin");
    expect(payload.accepted_statuscodes).toEqual(["200-299"]);
  });
});

describe("uptime-kuma homepage import", () => {
  it("maps siteMonitor and ping from services yaml", () => {
    const yaml = `- Infrastructure:
    - Pi-hole A:
        siteMonitor: http://10.0.0.4/admin
    - BIND A:
        ping: 10.0.0.2
- Monitoring:
    - Uptime Kuma:
        siteMonitor: http://10.0.0.105:3001
`;
    const monitors = monitorsFromHomepageServicesYaml(yaml);
    expect(monitors).toHaveLength(2);
    expect(monitors.find((m) => m.id === "pi-hole-a")).toMatchObject({
      type: "http",
      url: "http://10.0.0.4/admin",
      managed: true,
    });
    expect(monitors.find((m) => m.id === "bind-a")).toMatchObject({
      type: "ping",
      hostname: "10.0.0.2",
    });
  });

  it("homepageServiceToMonitor skips uptime-kuma self tile", () => {
    expect(
      homepageServiceToMonitor({ name: "Uptime Kuma", siteMonitor: "http://10.0.0.105:3001" }, "Monitoring"),
    ).toBeNull();
  });
});
