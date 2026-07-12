import { describe, expect, it } from "vitest";

import {
  BIND_LOG_PURGE_RUN_LOG,
  BIND_LOG_PURGE_SCRIPT_PATH,
  DEFAULT_THRESHOLD_FREE_PERCENT,
  buildBindLogPurgeCron,
  buildBindLogPurgeScript,
  logPurgeSkippedByFlags,
  resolveBindLogPurgeSettings,
} from "../../../clumps/services/bind/lib/bind-log-purge.mjs";

describe("bind-log-purge", () => {
  it("buildBindLogPurgeScript includes threshold guard and purge steps", () => {
    const script = buildBindLogPurgeScript({ thresholdFreePercent: 15 });
    expect(script).toContain("THRESHOLD=15");
    expect(script).toContain('if [ "$FREE" -ge "$THRESHOLD" ]');
    expect(script).toContain("journalctl --vacuum-size=50M");
    expect(script).toContain("apt-get clean");
    expect(script).toContain("syslog_rotations=");
    expect(script).toContain("logrotate -f /etc/logrotate.d/rsyslog");
  });

  it("buildBindLogPurgeCron has 5 fields and logs to hdc-bind-log-purge.log", () => {
    const cron = buildBindLogPurgeCron({ hour: 4, minute: 30 });
    expect(cron).toContain("CRON_TZ=UTC");
    expect(cron).toMatch(/^30 4 \* \* \* root /m);
    expect(cron).toContain(BIND_LOG_PURGE_SCRIPT_PATH);
    expect(cron).toContain(BIND_LOG_PURGE_RUN_LOG);
  });

  it("resolveBindLogPurgeSettings defaults enabled with 15% threshold", () => {
    expect(resolveBindLogPurgeSettings({})).toEqual({
      enabled: true,
      thresholdFreePercent: DEFAULT_THRESHOLD_FREE_PERCENT,
    });
  });

  it("resolveBindLogPurgeSettings honors config overrides", () => {
    expect(
      resolveBindLogPurgeSettings({
        log_purge: { enabled: false, threshold_free_percent: 20 },
      }),
    ).toEqual({ enabled: false, thresholdFreePercent: 20 });
  });

  it("logPurgeSkippedByFlags recognizes --skip-log-purge", () => {
    expect(logPurgeSkippedByFlags({ "skip-log-purge": "1" })).toBe(true);
    expect(logPurgeSkippedByFlags({})).toBe(false);
  });
});
