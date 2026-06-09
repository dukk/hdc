import { describe, expect, it } from "vitest";

import {
  alertContactHasDrift,
  alertContactTypeFromApi,
  deriveResourceId,
  liveAlertContactToConfig,
  liveMonitorToConfig,
  liveStatusPageToConfig,
  monitorHasDrift,
  monitorStatusFromApi,
  monitorTypeFromApi,
  monitorTypeToApi,
  normalizeUptimerobotConfig,
  parseMonitorAlertContacts,
  pspMonitorsFromApi,
  pspMonitorsToApi,
  pspSortFromApi,
  slugifyId,
  statusPageHasDrift,
} from "../../../packages/infrastructure/uptimerobot/lib/uptimerobot-config.mjs";
import { liveStateToConfigEntries } from "../../../packages/infrastructure/uptimerobot/lib/uptimerobot-import.mjs";

describe("uptimerobot-config", () => {
  it("slugifyId normalizes friendly names", () => {
    expect(slugifyId("Immich (dukk.org)")).toBe("immich-dukk-org");
  });

  it("deriveResourceId avoids collisions", () => {
    const used = new Set(["immich"]);
    expect(deriveResourceId("monitor", 1, "Immich", used)).toBe("immich-2");
  });

  it("maps monitor type enums", () => {
    expect(monitorTypeFromApi(1)).toBe("http");
    expect(monitorTypeToApi("ping")).toBe(3);
    expect(monitorStatusFromApi(2)).toBe("up");
  });

  it("maps alert contact and psp enums", () => {
    expect(alertContactTypeFromApi(2)).toBe("email");
    expect(pspSortFromApi(3)).toBe("status_up_down");
  });

  it("parseMonitorAlertContacts handles dash format", () => {
    const map = new Map([[457, "email-ops"]]);
    expect(parseMonitorAlertContacts("457_5_0-373_0_0", map)).toEqual([
      { contact_id: "373", threshold: 0, recurrence: 0 },
      { contact_id: "email-ops", threshold: 5, recurrence: 0 },
    ]);
  });

  it("pspMonitors round-trips all and id lists", () => {
    const byUr = new Map([
      [10, "web-a"],
      [20, "web-b"],
    ]);
    const byHdc = new Map([
      ["web-a", 10],
      ["web-b", 20],
    ]);
    expect(pspMonitorsFromApi(0, byUr)).toBe("all");
    expect(pspMonitorsFromApi("20-10", byUr)).toEqual(["web-a", "web-b"]);
    expect(pspMonitorsToApi("all", byHdc)).toBe(0);
    expect(pspMonitorsToApi(["web-b", "web-a"], byHdc)).toBe("10-20");
  });

  it("liveMonitorToConfig preserves managed and notes from existing", () => {
    const existing = {
      id: "immich",
      uptimerobot_id: 123,
      friendly_name: "Immich",
      type: "http",
      url: "https://immich.dukk.org",
      interval_seconds: 300,
      status: "up",
      managed: true,
      notes: "public site",
      alert_contacts: [],
      options: {},
    };
    const row = liveMonitorToConfig(
      {
        id: 123,
        friendly_name: "Immich",
        url: "https://immich.dukk.org",
        type: 1,
        interval: 300,
        status: 2,
      },
      existing,
      new Map(),
      new Set(["immich"])
    );
    expect(row?.id).toBe("immich");
    expect(row?.managed).toBe(true);
    expect(row?.notes).toBe("public site");
  });

  it("liveStateToConfigEntries preserves managed across import merge", () => {
    const live = {
      account: { email: "ops@example.com" },
      alertContacts: [
        {
          uptimerobot_id: 1,
          id: "email-ops",
          friendly_name: "Ops",
          type: "email",
          value: "ops@example.com",
          status: "active",
          managed: false,
          notes: null,
        },
      ],
      monitors: [],
      statusPages: [],
      raw: { alertContactRows: [], monitorRows: [], pspRows: [] },
    };
    const entries = liveStateToConfigEntries(
      live,
      [
        {
          id: "email-ops",
          uptimerobot_id: 1,
          friendly_name: "Ops",
          type: "email",
          value: "ops@example.com",
          status: "active",
          managed: true,
          notes: "primary",
        },
      ],
      [],
      []
    );
    expect(entries.alert_contacts[0].managed).toBe(true);
    expect(entries.alert_contacts[0].notes).toBe("primary");
  });

  it("monitorHasDrift detects url changes", () => {
    const base = {
      id: "web",
      uptimerobot_id: 1,
      friendly_name: "Web",
      type: "http",
      url: "https://a.example.com",
      interval_seconds: 300,
      status: "up",
      managed: false,
      notes: null,
      alert_contacts: [],
      options: {},
    };
    expect(monitorHasDrift(base, { ...base, url: "https://b.example.com" })).toBe(true);
    expect(monitorHasDrift(base, { ...base })).toBe(false);
  });

  it("statusPageHasDrift detects monitor membership changes", () => {
    const base = {
      id: "main",
      uptimerobot_id: 9,
      friendly_name: "Main",
      standard_url: "https://stats.uptimerobot.com/abc",
      custom_url: null,
      monitors: ["web-a"],
      sort: "name_asc",
      status: "active",
      managed: false,
      notes: null,
    };
    expect(statusPageHasDrift(base, { ...base, monitors: ["web-a", "web-b"] })).toBe(true);
  });

  it("normalizeUptimerobotConfig builds lookup maps", () => {
    const config = normalizeUptimerobotConfig({
      schema_version: 1,
      uptimerobot: { auth: {} },
      monitors: [{ id: "web", uptimerobot_id: 10, friendly_name: "Web", type: "http", interval_seconds: 300, status: "up", managed: false }],
      status_pages: [],
      alert_contacts: [],
    });
    expect(config.monitorsById.get("web")?.uptimerobot_id).toBe(10);
  });

  it("liveStatusPageToConfig maps standard_url", () => {
    const page = liveStatusPageToConfig(
      {
        id: 76,
        friendly_name: "HDC Status",
        monitors: 0,
        sort: 1,
        status: 1,
        standard_url: "https://stats.uptimerobot.com/RepjIrpxEZ",
      },
      null,
      new Map(),
      new Set()
    );
    expect(page?.standard_url).toBe("https://stats.uptimerobot.com/RepjIrpxEZ");
    expect(page?.monitors).toBe("all");
  });

  it("alertContactHasDrift detects value changes", () => {
    const base = liveAlertContactToConfig(
      { id: 1, friendly_name: "Ops", type: 2, status: 2, value: "a@example.com" },
      null,
      new Set()
    );
    expect(base).toBeTruthy();
    expect(
      alertContactHasDrift(/** @type {NonNullable<typeof base>} */ (base), {
        .../** @type {NonNullable<typeof base>} */ (base),
        value: "b@example.com",
      })
    ).toBe(true);
  });
});
