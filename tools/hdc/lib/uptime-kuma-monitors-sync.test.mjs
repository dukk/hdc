import { describe, expect, it, vi } from "vitest";

import {
  applyMonitorTags,
  liveTagNamesAfterPrune,
  pruneMonitorTags,
  tagAssignmentsFromMonitorRow,
} from "../../../packages/services/uptime-kuma/lib/uptime-kuma-monitors-sync.mjs";

/** @type {import('../../../packages/services/uptime-kuma/lib/uptime-kuma-config.mjs').ConfigMonitor} */
const baseEntry = {
  id: "audiobookshelf",
  name: "Audiobookshelf",
  type: "http",
  url: "https://bookshelf.dukk.org",
  hostname: null,
  group: "Applications",
  tags: ["Public"],
  interval: 60,
  ignore_tls: false,
  managed: true,
  notes: null,
};

describe("uptime-kuma-monitors-sync tags", () => {
  it("tagAssignmentsFromMonitorRow resolves tag_id to catalog name", () => {
    const tagIdToName = new Map([
      [3, "public"],
      [7, "family"],
    ]);
    const row = {
      tags: [
        { tag_id: 3, value: "" },
        { tag_id: 3, value: "" },
        { tag_id: 7, value: "" },
      ],
    };
    expect(tagAssignmentsFromMonitorRow(row, tagIdToName)).toEqual([
      { tagId: 3, name: "public", value: "" },
      { tagId: 3, name: "public", value: "" },
      { tagId: 7, name: "family", value: "" },
    ]);
  });

  it("liveTagNamesAfterPrune keeps first desired tag and drops stale names", () => {
    const tagIdToName = new Map([
      [3, "public"],
      [7, "family"],
    ]);
    const row = {
      tags: [
        { tag_id: 7, value: "" },
        { tag_id: 3, value: "" },
        { tag_id: 3, value: "" },
      ],
    };
    expect(liveTagNamesAfterPrune(row, tagIdToName, ["Public"])).toEqual(["public"]);
  });

  it("applyMonitorTags skips tags already on the monitor", async () => {
    const addMonitorTag = vi.fn().mockResolvedValue({ ok: true });
    const client = { addMonitorTag };
    const tagIdsByName = new Map([["public", 3]]);
    const logs = [];

    await applyMonitorTags(client, baseEntry, 5, tagIdsByName, {
      liveTagNames: ["Public"],
      log: (line) => logs.push(line),
    });

    expect(addMonitorTag).not.toHaveBeenCalled();
    expect(logs.some((l) => /already on monitor/.test(l))).toBe(true);
  });

  it("applyMonitorTags adds missing tags", async () => {
    const addMonitorTag = vi.fn().mockResolvedValue({ ok: true });
    const client = { addMonitorTag };
    const tagIdsByName = new Map([["public", 3]]);

    await applyMonitorTags(client, baseEntry, 5, tagIdsByName, {
      liveTagNames: [],
      log: () => {},
    });

    expect(addMonitorTag).toHaveBeenCalledOnce();
    expect(addMonitorTag).toHaveBeenCalledWith(3, 5, "");
  });

  it("pruneMonitorTags removes tags not in config and duplicate assignments", async () => {
    const deleteMonitorTag = vi.fn().mockResolvedValue({ ok: true });
    const client = { deleteMonitorTag };
    const tagIdsByName = new Map([["public", 3], ["family", 7]]);
    const rawRow = {
      tags: [
        { tag_id: 7, value: "" },
        { tag_id: 3, value: "" },
        { tag_id: 3, value: "" },
      ],
    };

    await pruneMonitorTags(client, baseEntry, 5, tagIdsByName, {
      rawRow,
      log: () => {},
    });

    expect(deleteMonitorTag).toHaveBeenCalledTimes(2);
    expect(deleteMonitorTag).toHaveBeenCalledWith(7, 5, "");
    expect(deleteMonitorTag).toHaveBeenCalledWith(3, 5, "");
  });
});
