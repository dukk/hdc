import { describe, expect, it } from "vitest";

import {
  buildMonitorByIdMap,
  collectTagsCatalogFromRows,
  findLiveMonitor,
  groupFromDescription,
  liveMonitorRowToConfig,
  monitorHasDrift,
  monitorToSocketPayload,
  normalizeUptimeKumaMonitorConfig,
  resolveGroupFromParent,
  resolveMonitorRetryFields,
  shouldIgnoreTlsForUrl,
  slugifyMonitorId,
  tagNamesFromRow,
} from "hdc/clump/services/uptime-kuma/lib/uptime-kuma-config.mjs";
import { liveMonitorsToConfigEntries } from "hdc/clump/services/uptime-kuma/lib/uptime-kuma-import.mjs";
import {
  homepageServiceToMonitor,
  monitorsFromHomepageServicesYaml,
  serviceNameToMonitorId,
} from "hdc/clump/services/uptime-kuma/lib/uptime-kuma-homepage-import.mjs";

/** @type {import("hdc/clump/services/uptime-kuma/lib/uptime-kuma-config.mjs").ConfigMonitor} */
const sampleConfigMonitor = {
  id: "pi-hole-a",
  name: "Pi-hole A",
  type: "http",
  url: "http://192.0.2.4/admin",
  hostname: null,
  group: "Infrastructure",
  tags: ["critical"],
  interval: 60,
  ...resolveMonitorRetryFields({}),
  ignore_tls: false,
  managed: true,
  notes: null,
};

/** @type {import("hdc/clump/services/uptime-kuma/lib/uptime-kuma-config.mjs").LiveMonitor} */
const sampleLiveMonitor = {
  ...sampleConfigMonitor,
  uptime_kuma_id: 1,
  parent_uptime_kuma_id: null,
};

describe("uptime-kuma config", () => {
  it("slugifyMonitorId normalizes service names", () => {
    expect(slugifyMonitorId("Pi-hole A")).toBe("pi-hole-a");
    expect(serviceNameToMonitorId("Proxmox B")).toBe("proxmox-b");
  });

  it("shouldIgnoreTlsForUrl detects Proxmox HTTPS", () => {
    expect(shouldIgnoreTlsForUrl("https://192.0.2.11:8006")).toBe(true);
    expect(shouldIgnoreTlsForUrl("http://192.0.2.4/admin")).toBe(false);
  });

  it("findLiveMonitor matches by hdc id then name", () => {
    const live = [
      { ...sampleLiveMonitor, id: "pi-hole-a", name: "Pi-hole A", uptime_kuma_id: 5 },
      { ...sampleLiveMonitor, id: "bind-a", name: "BIND A", uptime_kuma_id: 6 },
    ];
    expect(findLiveMonitor({ ...sampleConfigMonitor, id: "pi-hole-a" }, live)?.uptime_kuma_id).toBe(5);
    expect(findLiveMonitor({ ...sampleConfigMonitor, id: "other", name: "BIND A" }, live)?.id).toBe("bind-a");
    expect(findLiveMonitor({ ...sampleConfigMonitor, id: "missing", name: "Missing" }, live)).toBeNull();
  });

  it("normalizeUptimeKumaMonitorConfig strips legacy UK database ids", () => {
    const normalized = normalizeUptimeKumaMonitorConfig({
      monitors: [
        {
          id: "pi-hole-a",
          uptime_kuma_id: 24,
          parent_uptime_kuma_id: 43,
          name: "Pi-hole A",
          type: "http",
          url: "http://192.0.2.4/admin",
          managed: true,
        },
      ],
      tags: [{ name: "Public", uptime_kuma_tag_id: 2, color: "#dc2626" }],
    });
    expect(normalized.monitors[0]).not.toHaveProperty("uptime_kuma_id");
    expect(normalized.monitors[0]).not.toHaveProperty("parent_uptime_kuma_id");
    expect(normalized.tags[0]).toEqual({ name: "Public", color: "#dc2626" });
  });

  it("monitorHasDrift compares managed fields", () => {
    expect(monitorHasDrift(sampleConfigMonitor, sampleLiveMonitor)).toBe(false);
    expect(monitorHasDrift(sampleConfigMonitor, { ...sampleLiveMonitor, url: "http://192.0.2.5/admin" })).toBe(
      true,
    );
    expect(monitorHasDrift(sampleConfigMonitor, { ...sampleLiveMonitor, group: "Media" })).toBe(true);
    expect(monitorHasDrift(sampleConfigMonitor, { ...sampleLiveMonitor, tags: [] })).toBe(true);
  });

  it("groupFromDescription parses Group: prefix", () => {
    expect(groupFromDescription("Group: Infrastructure")).toBe("Infrastructure");
    expect(groupFromDescription("notes only")).toBeNull();
  });

  it("resolveGroupFromParent walks parent chain to group monitor", () => {
    const rows = [
      { id: 1, type: "group", name: "Infrastructure" },
      { id: 2, type: "http", name: "Pi-hole", parent: 1 },
    ];
    const byId = buildMonitorByIdMap(rows);
    expect(resolveGroupFromParent(2, byId)).toEqual({
      group: "Infrastructure",
      parent_uptime_kuma_id: 1,
    });
  });

  it("liveMonitorRowToConfig maps group from description and tags without UK ids", () => {
    const rows = [
      {
        id: 5,
        type: "http",
        name: "Pi-hole A",
        url: "http://192.0.2.4/admin",
        description: "Group: Infrastructure",
        tags: [{ name: "critical", color: "#dc2626", tag_id: 3 }],
      },
    ];
    const byId = buildMonitorByIdMap(rows);
    const cfg = liveMonitorRowToConfig(rows[0], null, byId);
    expect(cfg).toMatchObject({
      id: "pi-hole-a",
      group: "Infrastructure",
      tags: ["critical"],
      managed: true,
    });
    expect(cfg).not.toHaveProperty("uptime_kuma_id");
    expect(cfg).not.toHaveProperty("parent_uptime_kuma_id");
  });

  it("liveMonitorRowToConfig skips group and unsupported types", () => {
    const byId = buildMonitorByIdMap([
      { id: 1, type: "group", name: "Infrastructure" },
      { id: 2, type: "docker", name: "Docker" },
    ]);
    const warnings = [];
    expect(liveMonitorRowToConfig({ id: 1, type: "group", name: "Infrastructure" }, null, byId)).toBeNull();
    expect(
      liveMonitorRowToConfig({ id: 2, type: "docker", name: "Docker" }, null, byId, {
        log: (line) => warnings.push(line),
      }),
    ).toBeNull();
    expect(warnings.some((w) => w.includes("docker"))).toBe(true);
  });

  it("collectTagsCatalogFromRows builds unique tag catalog by name only", () => {
    const catalog = collectTagsCatalogFromRows([
      { id: 1, tags: [{ name: "critical", color: "#dc2626", tag_id: 3 }] },
      { id: 2, tags: [{ name: "critical", color: "#dc2626", tag_id: 3 }, { name: "lan", tag_id: 4 }] },
    ]);
    expect(catalog).toHaveLength(2);
    expect(catalog.find((t) => t.name === "critical")).toEqual({ name: "critical", color: "#dc2626" });
  });

  it("tagNamesFromRow extracts sorted tag names", () => {
    expect(tagNamesFromRow({ tags: [{ name: "b" }, { name: "a" }] })).toEqual(["a", "b"]);
  });

  it("liveMonitorsToConfigEntries imports from raw rows with groups and no UK ids", () => {
    const live = {
      monitors: [],
      tags: [],
      raw: {
        monitorRows: [
          {
            id: 10,
            type: "ping",
            name: "BIND A",
            hostname: "192.0.2.2",
            description: "Group: Infrastructure",
          },
        ],
      },
    };
    const entries = liveMonitorsToConfigEntries(live, []);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "BIND A",
      group: "Infrastructure",
      managed: true,
    });
    expect(entries[0]).not.toHaveProperty("uptime_kuma_id");
  });

  it("monitorToSocketPayload builds http monitor", () => {
    const payload = monitorToSocketPayload(sampleConfigMonitor);
    expect(payload.type).toBe("http");
    expect(payload.url).toBe("http://192.0.2.4/admin");
    expect(payload.description).toBe("");
    expect(payload.maxretries).toBe(3);
    expect(payload.retryInterval).toBe(60);
    expect(payload.timeout).toBe(48);
    expect(payload.accepted_statuscodes).toEqual(["200-299"]);
    expect(payload.conditions).toEqual([]);
    expect(payload.kafkaProducerBrokers).toEqual([]);
  });

  it("monitorToSocketPayload honors retry tuning fields", () => {
    const payload = monitorToSocketPayload({
      ...sampleConfigMonitor,
      max_retries: 5,
      retry_interval: 30,
      timeout: 20,
      accepted_status_codes: ["200-399"],
    });
    expect(payload.maxretries).toBe(5);
    expect(payload.retryInterval).toBe(30);
    expect(payload.timeout).toBe(20);
    expect(payload.accepted_statuscodes).toEqual(["200-399"]);
  });

  it("monitorToSocketPayload sets parent and live id when provided", () => {
    const payload = monitorToSocketPayload(sampleConfigMonitor, true, { parentId: 1, liveId: 5 });
    expect(payload.parent).toBe(1);
    expect(payload.id).toBe(5);
  });

  it("monitorToSocketPayload builds ping monitor with UK 2.x required fields", () => {
    const payload = monitorToSocketPayload({
      id: "bind-a",
      name: "BIND A",
      type: "ping",
      url: null,
      hostname: "192.0.2.2",
      group: "Infrastructure",
      tags: [],
      interval: 60,
      ignore_tls: false,
      managed: true,
      notes: null,
    });
    expect(payload.type).toBe("ping");
    expect(payload.hostname).toBe("192.0.2.2");
    expect(payload.accepted_statuscodes).toEqual(["200-299"]);
    expect(payload.conditions).toEqual([]);
  });
});

describe("uptime-kuma homepage import", () => {
  it("maps siteMonitor and ping from services yaml", () => {
    const yaml = `- Infrastructure:
    - Pi-hole A:
        siteMonitor: http://192.0.2.4/admin
    - BIND A:
        ping: 192.0.2.2
- Monitoring:
    - Uptime Kuma:
        siteMonitor: http://192.0.2.105:3001
`;
    const monitors = monitorsFromHomepageServicesYaml(yaml);
    expect(monitors).toHaveLength(2);
    expect(monitors.find((m) => m.id === "pi-hole-a")).toMatchObject({
      type: "http",
      url: "http://192.0.2.4/admin",
      managed: true,
    });
    expect(monitors.find((m) => m.id === "bind-a")).toMatchObject({
      type: "ping",
      hostname: "192.0.2.2",
    });
    expect(monitors.every((m) => !("uptime_kuma_id" in m))).toBe(true);
  });

  it("homepageServiceToMonitor skips uptime-kuma self tile", () => {
    expect(
      homepageServiceToMonitor({ name: "Uptime Kuma", siteMonitor: "http://192.0.2.105:3001" }, "Monitoring"),
    ).toBeNull();
  });
});
