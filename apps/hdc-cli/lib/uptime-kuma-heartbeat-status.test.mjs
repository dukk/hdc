import { describe, expect, it } from "vitest";

import {
  UK_HEARTBEAT_DOWN,
  UK_HEARTBEAT_UP,
  collectFailingFromHeartbeatData,
  latestHeartbeatForMonitor,
} from "hdc/clump/services/uptime-kuma/lib/uptime-kuma-heartbeat-status.mjs";

describe("uptime-kuma-heartbeat-status", () => {
  it("latestHeartbeatForMonitor reads first beat", () => {
    const hb = latestHeartbeatForMonitor(
      {
        "12": [{ status: UK_HEARTBEAT_DOWN, msg: "timeout", time: "2026-01-01T00:00:00.000Z" }],
      },
      12,
    );
    expect(hb?.status).toBe(UK_HEARTBEAT_DOWN);
  });

  it("collectFailingFromHeartbeatData returns only DOWN monitors", () => {
    const result = collectFailingFromHeartbeatData(
      [
        { id: 1, name: "Up svc", type: "http", url: "https://example.invalid", active: true },
        { id: 2, name: "Down svc", type: "http", url: "https://down.invalid", active: true },
        { id: 3, name: "Paused", type: "http", active: false },
      ],
      {
        "1": [{ status: UK_HEARTBEAT_UP, msg: "OK" }],
        "2": [{ status: UK_HEARTBEAT_DOWN, msg: "timeout", ping: null, time: "2026-01-01T00:00:00.000Z" }],
      },
    );
    expect(result.failing_count).toBe(1);
    expect(result.failing[0].name).toBe("Down svc");
    expect(result.failing[0].target).toBe("https://down.invalid");
  });
});
