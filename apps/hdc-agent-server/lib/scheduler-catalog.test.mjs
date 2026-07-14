import { describe, expect, it } from "vitest";

import {
  cronMatches,
  defaultSchedules,
  normalizeSchedules,
  schedulesFromConfig,
} from "./scheduler-catalog.mjs";

describe("scheduler-catalog", () => {
  it("drops agent-type schedules", () => {
    const list = normalizeSchedules([
      { id: "x", cron: "0 * * * *", cli: ["list"], type: "agent" },
      { id: "y", cron: "0 3 * * *", cli: ["maintain", "daily"] },
    ]);
    expect(list.map((s) => s.id)).toEqual(["y"]);
  });

  it("provides defaults", () => {
    expect(schedulesFromConfig({}).length).toBeGreaterThanOrEqual(2);
    expect(defaultSchedules().some((s) => s.id === "hdc-ops-daily")).toBe(true);
  });

  it("matches simple cron in UTC", () => {
    const d = new Date(Date.UTC(2026, 6, 14, 3, 0, 10));
    expect(cronMatches("0 3 * * *", d)).toBe(true);
    expect(cronMatches("15 3 * * *", d)).toBe(false);
  });
});
