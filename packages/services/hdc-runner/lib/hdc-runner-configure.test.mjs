import { describe, expect, it } from "vitest";

import { buildPruneKeepScheduleIds } from "./hdc-runner-configure.mjs";

describe("hdc-runner-configure", () => {
  it("buildPruneKeepScheduleIds uses schedule ids not cron basenames", () => {
    const keep = buildPruneKeepScheduleIds({
      schedules: [{ id: "public-edge" }, { id: "daily-digest" }],
    });
    expect(keep).toEqual(["public-edge", "daily-digest"]);
    expect(keep).not.toContain("hdc-runner-public-edge");
  });
});
