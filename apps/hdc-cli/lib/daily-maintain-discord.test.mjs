import { describe, expect, it } from "vitest";

import { buildDailyMaintainDiscordSummary } from "./daily-maintain-discord.mjs";

describe("daily-maintain-discord", () => {
  it("builds OK summary with step counts", () => {
    const { title, message } = buildDailyMaintainDiscordSummary({
      exitCode: 0,
      dryRun: false,
      results: [
        { key: "service/bind/maintain", status: "maintain", ok: true },
        { key: "service/pi-hole/maintain", status: "maintain", ok: true },
        { key: "client/windows/query", status: "skipped", ok: null },
      ],
    });
    expect(title).toContain("OK");
    expect(message).toContain("2/2 steps ok");
    expect(message).toContain("1 skipped");
  });

  it("builds FAILED summary with failed package names", () => {
    const { title, message } = buildDailyMaintainDiscordSummary({
      exitCode: 1,
      dryRun: false,
      results: [
        { key: "service/bind/maintain", status: "maintain", ok: true },
        { key: "infrastructure/proxmox/maintain", status: "maintain", ok: false },
      ],
    });
    expect(title).toContain("FAILED");
    expect(message).toContain("1/2 steps ok");
    expect(message).toContain("proxmox");
  });

  it("redacts IPs from failure messages", () => {
    const { message } = buildDailyMaintainDiscordSummary({
      exitCode: 1,
      results: [
        {
          key: "service/nginx/maintain",
          status: "maintain",
          ok: false,
          error: "probe failed at 192.0.2.10",
        },
      ],
    });
    expect(message).not.toContain("192.0.2.10");
    expect(message).toContain("[redacted]");
  });

  it("includes dry-run in title", () => {
    const { title } = buildDailyMaintainDiscordSummary({
      exitCode: 0,
      dryRun: true,
      results: [],
    });
    expect(title).toContain("dry-run");
  });
});
