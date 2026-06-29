import { describe, expect, it } from "vitest";

import {
  buildPublicGroupListForSave,
  groupsFromPublicGroupList,
  liveStatusPageToConfig,
  statusPageHasDrift,
  statusPageToSaveConfig,
} from "../../../packages/services/uptime-kuma/lib/uptime-kuma-status-page-config.mjs";

/** @type {import("../../../packages/services/uptime-kuma/lib/uptime-kuma-status-page-config.mjs").ConfigStatusPage} */
const sampleStatusPage = {
  id: "public",
  slug: "public",
  title: "Public",
  description: null,
  theme: "auto",
  published: true,
  show_tags: false,
  show_powered_by: true,
  show_certificate_expiry: false,
  show_only_last_heartbeat: false,
  auto_refresh_interval: 300,
  custom_css: "",
  footer_text: null,
  rss_title: null,
  domain_names: [],
  icon: "/icon.svg",
  analytics_id: null,
  analytics_script_url: null,
  analytics_type: null,
  managed: true,
  groups: [{ name: "Core", weight: 1, monitors: [{ id: "pi-hole-a" }] }],
};

describe("uptime-kuma status page config", () => {
  it("groupsFromPublicGroupList maps uk monitor ids to hdc ids", () => {
    const groups = groupsFromPublicGroupList(
      [
        {
          name: "Infrastructure",
          weight: 1,
          monitorList: [{ id: 6, sendUrl: true }, { id: 999 }],
        },
      ],
      new Map([[6, "bind-a"]]),
    );
    expect(groups).toEqual([
      {
        name: "Infrastructure",
        weight: 1,
        monitors: [{ id: "bind-a", send_url: true, url: null }],
      },
    ]);
  });

  it("liveStatusPageToConfig merges list row and public groups without UK id", () => {
    const page = liveStatusPageToConfig(
      { id: 1, slug: "public", title: "Public Status", theme: "dark", showTags: true },
      { description: "All public services" },
      {
        publicGroupList: [
          {
            name: "Core",
            monitorList: [{ id: 24, sendUrl: false }],
          },
        ],
      },
      new Map([[24, "pi-hole-a"]]),
    );
    expect(page).toMatchObject({
      id: "public",
      slug: "public",
      title: "Public Status",
      theme: "dark",
      show_tags: true,
      description: "All public services",
      managed: true,
      groups: [{ name: "Core", monitors: [{ id: "pi-hole-a", send_url: false, url: null }] }],
    });
    expect(page).not.toHaveProperty("uptime_kuma_id");
  });

  it("buildPublicGroupListForSave resolves hdc monitor ids via live monitors", () => {
    const payload = buildPublicGroupListForSave(
      {
        ...sampleStatusPage,
        groups: [
          {
            name: "Core",
            weight: 1,
            monitors: [{ id: "pi-hole-a", send_url: true }],
          },
        ],
      },
      [
        {
          id: "pi-hole-a",
          name: "Pi-hole A",
          type: "http",
          url: "http://192.0.2.4/admin",
          hostname: null,
          group: null,
          tags: [],
          interval: 60,
          ignore_tls: false,
          managed: true,
          notes: null,
        },
      ],
      [
        {
          id: "pi-hole-a",
          name: "Pi-hole A",
          type: "http",
          url: "http://192.0.2.4/admin",
          hostname: null,
          group: null,
          tags: [],
          interval: 60,
          ignore_tls: false,
          managed: true,
          notes: null,
          uptime_kuma_id: 24,
        },
      ],
    );
    expect(payload).toEqual([
      {
        name: "Core",
        weight: 1,
        monitorList: [{ id: 24, sendUrl: true }],
      },
    ]);
  });

  it("statusPageHasDrift detects group monitor changes", () => {
    expect(statusPageHasDrift(sampleStatusPage, { ...sampleStatusPage })).toBe(false);
    expect(
      statusPageHasDrift(sampleStatusPage, {
        ...sampleStatusPage,
        groups: [{ name: "Core", weight: 1, monitors: [{ id: "bind-a" }] }],
      }),
    ).toBe(true);
  });

  it("statusPageToSaveConfig maps snake_case to UK camelCase", () => {
    expect(
      statusPageToSaveConfig({
        ...sampleStatusPage,
        description: "desc",
        theme: "dark",
        show_tags: true,
        show_powered_by: false,
        show_certificate_expiry: true,
        auto_refresh_interval: 120,
        custom_css: ".x{}",
        footer_text: "footer",
        rss_title: "rss",
        domain_names: ["status.example.com"],
        groups: [],
      }),
    ).toMatchObject({
      slug: "public",
      showTags: true,
      showPoweredBy: false,
      domainNameList: ["status.example.com"],
      autoRefreshInterval: 120,
    });
  });
});
