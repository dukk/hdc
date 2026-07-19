import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  acquireDailyMaintainLock,
  DAILY_STEP_DEFAULT_TIMEOUT_MS,
  processExists,
  readDailyMaintainLock,
  releaseDailyMaintainLock,
  resolveDailyStepTimeoutMs,
} from "./daily-maintain-lock.mjs";

describe("daily-maintain-lock", () => {
  it("acquires and releases a lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "hdc-lock-"));
    const lockPath = join(dir, "daily.lock");
    const got = acquireDailyMaintainLock({ lockPath, pid: 12345, nowIso: () => "2026-01-01T00:00:00.000Z" });
    expect(got.ok).toBe(true);
    expect(readDailyMaintainLock(lockPath)).toEqual({
      pid: 12345,
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    releaseDailyMaintainLock(lockPath, 12345);
    expect(readDailyMaintainLock(lockPath)).toBeNull();
  });

  it("blocks when another live pid holds the lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "hdc-lock-"));
    const lockPath = join(dir, "daily.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: "2026-01-01T00:00:00.000Z" }),
      "utf8",
    );
    const got = acquireDailyMaintainLock({ lockPath, pid: process.pid + 1 });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.holder.pid).toBe(process.pid);
  });

  it("replaces a stale lock for a dead pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "hdc-lock-"));
    const lockPath = join(dir, "daily.lock");
    // Pick a pid that almost certainly does not exist
    let deadPid = 999_999_999;
    while (processExists(deadPid)) deadPid -= 1;
    writeFileSync(lockPath, JSON.stringify({ pid: deadPid, startedAt: "old" }), "utf8");
    const got = acquireDailyMaintainLock({ lockPath, pid: 42, nowIso: () => "new" });
    expect(got.ok).toBe(true);
    expect(JSON.parse(readFileSync(lockPath, "utf8")).pid).toBe(42);
  });
});

describe("resolveDailyStepTimeoutMs", () => {
  it("defaults to one hour", () => {
    expect(resolveDailyStepTimeoutMs({}, {})).toBe(DAILY_STEP_DEFAULT_TIMEOUT_MS);
  });

  it("prefers flags then env", () => {
    expect(resolveDailyStepTimeoutMs({ stepTimeoutMs: 1000 }, { HDC_DAILY_STEP_TIMEOUT_MS: "2000" })).toBe(
      1000,
    );
    expect(resolveDailyStepTimeoutMs({}, { HDC_DAILY_STEP_TIMEOUT_MS: "2000" })).toBe(2000);
  });
});
