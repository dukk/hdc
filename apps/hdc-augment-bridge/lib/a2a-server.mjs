import { randomUUID } from "node:crypto";
import http from "node:http";

import { extractMessageText } from "../hdc-agent-server/lib/a2a-http.mjs";
import { createTaskQueue } from "../hdc-agent-server/lib/task-queue.mjs";

import { runAugmentAdapter } from "./adapters.mjs";
import { augmentBridgeConfigFromEnv, buildAugmentAgentCard } from "./agent-card.mjs";

const A2A_VERSION = "0.3.0";

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<unknown>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function jsonResponse(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "A2A-Version": A2A_VERSION,
  });
  res.end(JSON.stringify(body));
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {string} expectedToken
 */
function assertBridgeAuth(req, expectedToken) {
  if (!expectedToken) return;
  const auth = String(req.headers.authorization ?? "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token !== expectedToken) {
    const err = new Error("unauthorized");
    // @ts-expect-error status
    err.status = 401;
    throw err;
  }
}

/**
 * @param {{ id: string, status: string, message: string, result?: string, error?: string, createdAt: string, updatedAt: string }} task
 */
function toA2aTask(task) {
  const state =
    task.status === "completed"
      ? "completed"
      : task.status === "failed"
        ? "failed"
        : task.status === "working"
          ? "working"
          : "submitted";
  /** @type {Record<string, unknown>} */
  const result = {
    kind: "task",
    id: task.id,
    contextId: task.id,
    status: { state, timestamp: task.updatedAt || task.createdAt },
  };
  if (task.result) {
    result.artifacts = [
      {
        artifactId: `${task.id}-response`,
        name: "response",
        parts: [{ kind: "text", text: task.result }],
      },
    ];
  }
  if (task.error) {
    result.status = {
      state: "failed",
      timestamp: task.updatedAt,
      message: { role: "agent", parts: [{ kind: "text", text: task.error }] },
    };
  }
  return result;
}

/**
 * @param {object} opts
 * @param {ReturnType<typeof augmentBridgeConfigFromEnv>} opts.config
 */
export function createAugmentBridgeServer(opts) {
  const config = opts.config;
  const queue = createTaskQueue();

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? `localhost:${config.port}`;
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname;

      if (
        (path === "/.well-known/agent.json" ||
          path === "/.well-known/agent-card.json" ||
          path === "/a2a/agent-card") &&
        req.method === "GET"
      ) {
        jsonResponse(
          res,
          200,
          buildAugmentAgentCard({
            name: config.name,
            hostHeader: host,
            description: config.description || undefined,
            runtime: config.runtime,
            repos: config.repos,
            delegatableBy: config.delegatableBy,
          }),
        );
        return;
      }

      if (path === "/health" && req.method === "GET") {
        jsonResponse(res, 200, { ok: true, name: config.name, runtime: config.runtime, busy: queue.isBusy() });
        return;
      }

      const isJsonRpc =
        (path === "/a2a" || path === "/a2a/" || path === "/a2a/message:send") && req.method === "POST";
      if (!isJsonRpc) {
        jsonResponse(res, 404, { error: "not found" });
        return;
      }

      assertBridgeAuth(req, config.token);
      const body = /** @type {Record<string, unknown>} */ (await readJsonBody(req));
      const method = typeof body.method === "string" ? body.method : "message/send";
      const id = body.id ?? randomUUID();

      if (method === "tasks/get") {
        const params = /** @type {Record<string, unknown>} */ (body.params ?? {});
        const taskId = String(params.id ?? "");
        const task = queue.get(taskId);
        if (!task) {
          jsonResponse(res, 200, {
            jsonrpc: "2.0",
            id,
            error: { code: -32001, message: `task not found: ${taskId}` },
          });
          return;
        }
        jsonResponse(res, 200, { jsonrpc: "2.0", id, result: toA2aTask(task) });
        return;
      }

      if (method !== "message/send" && method !== "SendMessage") {
        jsonResponse(res, 200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not supported: ${method}` },
        });
        return;
      }

      const text = extractMessageText(body.params);
      const taskId = randomUUID();
      queue.enqueue(taskId, text, async (msg) => {
        const result = await runAugmentAdapter(config, msg);
        return JSON.stringify({
          summary: result.summary,
          task_id: result.task_id ?? result.run_id ?? result.agent_id ?? taskId,
          agent_id: result.agent_id,
          run_id: result.run_id,
        });
      });

      const task = queue.get(taskId);
      jsonResponse(res, 200, {
        jsonrpc: "2.0",
        id,
        result: toA2aTask(
          task ?? { id: taskId, status: "submitted", message: text, createdAt: "", updatedAt: "" },
        ),
      });
    } catch (e) {
      const status = /** @type {Error & { status?: number }} */ (e).status === 401 ? 401 : 500;
      jsonResponse(res, status, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return { server, queue, config };
}
