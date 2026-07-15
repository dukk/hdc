import { describe, expect, it } from "vitest";

import {
  bindWidgetEnabled,
  buildBindWidgetStatsFiles,
  countBindZones,
} from "hdc/clump/services/homepage/lib/homepage-bind-widget.mjs";

describe("homepage bind widget", () => {
  it("bindWidgetEnabled respects enabled flag", () => {
    expect(bindWidgetEnabled({ bind_widget: { enabled: true } })).toBe(true);
    expect(bindWidgetEnabled({ bind_widget: { enabled: false } })).toBe(false);
    expect(bindWidgetEnabled({})).toBe(false);
  });

  it("countBindZones tallies forward and reverse zones", () => {
    expect(
      countBindZones([
        { id: "example.invalid", zone_type: "forward", records: [] },
        { id: "other.invalid", zone_type: "forward", records: [] },
        { id: "0.0.10.in-addr.arpa", zone_type: "reverse", subnet: "10.0.0.0/24", records: [] },
      ]),
    ).toEqual({
      zones_total: 3,
      zones_forward: 2,
      zones_reverse: 1,
    });
  });

  it("buildBindWidgetStatsFiles writes primary and secondary stats", () => {
    const cfg = {
      schema_version: 2,
      zones: [
        { id: "example.invalid", zone_type: "forward", records: [] },
        { id: "0.0.10.in-addr.arpa", zone_type: "reverse", subnet: "10.0.0.0/24", records: [] },
      ],
      deployments: [{ system_id: "vm-bind-a", role: "primary" }],
    };
    const files = buildBindWidgetStatsFiles(cfg);
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({
      rel: "stats/bind-a.json",
      json: {
        zones_total: 2,
        zones_forward: 1,
        zones_reverse: 1,
        role: "primary",
      },
    });
    expect(files[1].json.role).toBe("secondary");
  });
});
