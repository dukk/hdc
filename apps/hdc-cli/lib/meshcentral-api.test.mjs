import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { connectMeshcentralApi } from "hdc/clump/services/meshcentral/lib/meshcentral-api.mjs";

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeWebSocket.CONNECTING;
  /** @type {string[]} */
  sent = [];

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
      queueMicrotask(() => {
        this.emit("message", JSON.stringify({ action: "serverinfo", serverinfo: { domain: "" } }));
      });
    });
  }

  /**
   * @param {string} data
   */
  send(data) {
    this.sent.push(data);
    const msg = JSON.parse(data);
    queueMicrotask(() => {
      if (msg.action === "nodes") {
        // Unsolicited empty push must not win the race over the real responseid reply.
        this.emit("message", JSON.stringify({ action: "nodes", nodes: {} }));
        this.emit(
          "message",
          JSON.stringify({
            action: "nodes",
            responseid: msg.responseid,
            nodes: {
              "mesh//g": [{ _id: "node//1", name: "pc-a", conn: 1, pwr: 1, osdesc: "Windows" }],
            },
          }),
        );
      } else if (msg.action === "meshes") {
        this.emit(
          "message",
          JSON.stringify({ action: "meshes", responseid: msg.responseid, meshes: [] }),
        );
      } else if (msg.action === "wakedevices" || msg.action === "poweraction") {
        this.emit(
          "message",
          JSON.stringify({ action: msg.action, responseid: msg.responseid, result: "ok" }),
        );
      } else if (msg.action === "runcommands") {
        // ACK then agent stdout reply (MeshCentral broadcasts as action:msg).
        this.emit(
          "message",
          JSON.stringify({ action: "runcommands", responseid: msg.responseid, result: "ok" }),
        );
        this.emit(
          "message",
          JSON.stringify({
            action: "msg",
            type: "runcommands",
            responseid: msg.responseid,
            result: "df-output",
          }),
        );
      }
    });
  }

  close() {
    this.readyState = 3;
  }
}

describe("connectMeshcentralApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists nodes, powers, and runs commands", async () => {
    const client = await connectMeshcentralApi({
      url: "wss://meshcentral.example.invalid/control.ashx",
      username: "admin",
      password: "secret",
      WebSocketImpl: /** @type {any} */ (FakeWebSocket),
      log: () => {},
    });
    const nodes = await client.listNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("pc-a");

    const power = await client.power(["node//1"], "wake");
    expect(power.result).toBe("ok");

    const run = await client.runCommand("node//1", "df -h");
    expect(run.ok).toBe(true);
    expect(run.output).toContain("df-output");

    await client.close();
  });
});
