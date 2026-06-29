import { describe, expect, it, vi } from "vitest";

import {
  monitorListRowsFromPayload,
  statusPageListRowsFromPayload,
  waitForMonitorListEvent,
  waitForStatusPageListEvent,
} from "../../../packages/services/uptime-kuma/lib/uptime-kuma-api.mjs";

describe("uptime-kuma-api monitorList", () => {
  it("monitorListRowsFromPayload converts object map to array", () => {
    expect(monitorListRowsFromPayload({ 1: { id: 1, name: "A" }, 2: { id: 2, name: "B" } })).toEqual([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);
    expect(monitorListRowsFromPayload([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(monitorListRowsFromPayload(null)).toEqual([]);
  });

  it("waitForMonitorListEvent resolves on monitorList socket event", async () => {
    /** @type {import("socket.io-client").Socket} */
    const socket = {
      once(event, handler) {
        expect(event).toBe("monitorList");
        setTimeout(() => handler({ 5: { id: 5, name: "Pi-hole", type: "http" } }), 10);
      },
    };

    const list = await waitForMonitorListEvent(socket, 1000);
    expect(list).toEqual({ 5: { id: 5, name: "Pi-hole", type: "http" } });
  });

  it("waitForMonitorListEvent rejects on timeout", async () => {
    /** @type {import("socket.io-client").Socket} */
    const socket = {
      once() {},
    };
    await expect(waitForMonitorListEvent(socket, 50)).rejects.toThrow(/monitorList event/);
  });
});

describe("uptime-kuma-api getMonitorList flow", () => {
  it("combines monitorList event with getMonitorList callback", async () => {
    const rows = { 10: { id: 10, name: "BIND", type: "ping", hostname: "192.0.2.2" } };

    /** @type {import("socket.io-client").Socket} */
    const socket = {
      connected: true,
      once(event, handler) {
        if (event === "monitorList") {
          queueMicrotask(() => handler(rows));
        }
      },
      emit(event, ...args) {
        const callback = args[args.length - 1];
        if (event === "getMonitorList" && typeof callback === "function") {
          queueMicrotask(() => callback({ ok: true }));
        }
      },
      disconnect: vi.fn(),
    };

    const listPromise = waitForMonitorListEvent(socket, 1000);
    socket.emit("getMonitorList", (resp) => {
      expect(resp.ok).toBe(true);
    });
    const list = await listPromise;
    expect(monitorListRowsFromPayload(list)).toEqual([rows[10]]);
  });
});

describe("uptime-kuma-api statusPageList", () => {
  it("statusPageListRowsFromPayload converts object map to array", () => {
    expect(statusPageListRowsFromPayload({ 1: { id: 1, slug: "public" } })).toEqual([
      { id: 1, slug: "public" },
    ]);
  });

  it("waitForStatusPageListEvent resolves on statusPageList socket event", async () => {
    /** @type {import("socket.io-client").Socket} */
    const socket = {
      once(event, handler) {
        expect(event).toBe("statusPageList");
        setTimeout(() => handler({ 1: { id: 1, slug: "public", title: "Public" } }), 10);
      },
    };
    const list = await waitForStatusPageListEvent(socket, 1000);
    expect(list).toEqual({ 1: { id: 1, slug: "public", title: "Public" } });
  });
});
