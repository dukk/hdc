import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseScheduleLogRuns,
  filterRunsInWindow,
  collectScheduleStats,
  formatScheduleSummaryMessage,
  buildScheduleSummary,
} from "./schedule-summary.mjs";

describe("parseScheduleLogRuns", () => {
  it("pairs start and exit lines", () => {
    const text = `
=== 2026-07-21T00:00:00.000Z job monitor-uptime-kuma started ===
--- 2026-07-21T00:01:00.000Z exit=0 ---
=== 2026-07-21T04:00:00.000Z job monitor-uptime-kuma started ===
--- 2026-07-21T04:01:00.000Z exit=1 ---
`;
    const runs = parseScheduleLogRuns(text);
    expect(runs).toHaveLength(2);
    expect(runs[0].exitCode).toBe(0);
    expect(runs[1].exitCode).toBe(1);
  });

  it("counts orphan exits", () => {
    const text = `--- 2026-07-21T12:00:00.000Z exit=0 ---\n`;
    expect(parseScheduleLogRuns(text)).toHaveLength(1);
  });
});

describe("filterRunsInWindow", () => {
  it("keeps runs inside the window", () => {
    const runs = [
      { startedAt: "2026-07-20T10:00:00.000Z", finishedAt: "2026-07-20T10:01:00.000Z", exitCode: 0 },
      { startedAt: "2026-07-21T10:00:00.000Z", finishedAt: "2026-07-21T10:01:00.000Z", exitCode: 0 },
    ];
    const now = Date.parse("2026-07-21T12:00:00.000Z");
    const since = now - 24 * 60 * 60 * 1000;
    expect(filterRunsInWindow(runs, since, now)).toHaveLength(1);
  });
});

describe("collectScheduleStats + format", () => {
  it("rolls up logs with cron from schedules.json", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-sched-sum-"));
    try {
      const logDir = join(root, "logs");
      mkdirSync(logDir, { recursive: true });
      writeFileSync(
        join(logDir, "monitor-uptime-kuma.log"),
        `
=== 2026-07-21T00:00:00.000Z job monitor-uptime-kuma started ===
--- 2026-07-21T00:01:00.000Z exit=0 ---
=== 2026-07-21T04:00:00.000Z job monitor-uptime-kuma started ===
--- 2026-07-21T04:01:00.000Z exit=0 ---
`,
        "utf8",
      );
      writeFileSync(
        join(root, "schedules.json"),
        JSON.stringify({
          schedules: [
            { id: "monitor-uptime-kuma", cron: "0 */4 * * *" },
            { id: "schedule-summary", cron: "0 12 * * *" },
          ],
        }),
        "utf8",
      );

      const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
      const summary = buildScheduleSummary({
        metaRoot: root,
        nowMs,
        windowMs: 24 * 60 * 60 * 1000,
      });
      expect(summary.stats.some((s) => s.id === "schedule-summary")).toBe(false);
      const mon = summary.stats.find((s) => s.id === "monitor-uptime-kuma");
      expect(mon?.runs).toBe(2);
      expect(mon?.ok).toBe(2);
      expect(mon?.fail).toBe(0);
      expect(mon?.cron).toBe("0 */4 * * *");
      expect(summary.allOk).toBe(true);
      expect(summary.message).toMatch(/monitor-uptime-kuma/);
      expect(summary.message).toMatch(/All scheduled jobs OK/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports failures in the window", () => {
    const stats = [
      {
        id: "monitor-cluster",
        cron: "15 */6 * * *",
        runs: 2,
        ok: 1,
        fail: 1,
        lastExit: 1,
        lastFinishedAt: "2026-07-21T06:00:00.000Z",
      },
    ];
    const msg = formatScheduleSummaryMessage(stats);
    expect(msg.allOk).toBe(false);
    expect(msg.totalFail).toBe(1);
    expect(msg.message).toMatch(/Failures in window: 1/);
  });
});

describe("collectScheduleStats empty", () => {
  it("lists configured schedules with zero runs", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-sched-empty-"));
    try {
      mkdirSync(join(root, "logs"), { recursive: true });
      writeFileSync(
        join(root, "schedules.json"),
        JSON.stringify({ schedules: [{ id: "public-edge", cron: "0 8 * * *" }] }),
        "utf8",
      );
      const stats = collectScheduleStats({
        logDir: join(root, "logs"),
        schedules: [{ id: "public-edge", cron: "0 8 * * *" }],
        nowMs: Date.parse("2026-07-21T12:00:00.000Z"),
      });
      expect(stats).toHaveLength(1);
      expect(stats[0].runs).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
