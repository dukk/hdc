import { describe, expect, it } from "vitest";

import {
  lastScheduleLogRun,
  parseScheduleLogRuns,
} from "./hdc-runner-log-parse.mjs";

describe("parseScheduleLogRuns", () => {
  it("parses start and end markers", () => {
    const text = [
      "=== 2026-06-28T08:00:00.000Z job daily-digest started ===",
      "some output",
      "--- 2026-06-28T08:05:00.000Z exit=0 ---",
      "stdout here",
      "=== 2026-06-28T09:00:00.000Z job daily-digest started ===",
      "--- 2026-06-28T09:01:00.000Z exit=1 ---",
    ].join("\n");

    const runs = parseScheduleLogRuns(text);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual({
      started_at: "2026-06-28T08:00:00.000Z",
      finished_at: "2026-06-28T08:05:00.000Z",
      exit_code: 0,
    });
    expect(runs[1].exit_code).toBe(1);
  });

  it("returns empty for blank log", () => {
    expect(parseScheduleLogRuns("")).toEqual([]);
  });

  it("lastScheduleLogRun returns most recent finished run", () => {
    const text = [
      "--- 2026-06-28T08:05:00.000Z exit=0 ---",
      "=== 2026-06-28T09:00:00.000Z job x started ===",
      "--- 2026-06-28T09:01:00.000Z exit=2 ---",
    ].join("\n");
    expect(lastScheduleLogRun(text)).toEqual({
      last_run_iso: "2026-06-28T09:01:00.000Z",
      last_exit_code: 2,
    });
  });
});
