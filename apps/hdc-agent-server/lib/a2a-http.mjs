import { randomUUID } from "node:crypto";

import { buildAgentCard } from "./agent-card.mjs";

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
 * @param {Record<string, string>} [headers]
 */
function jsonResponse(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "A2A-Version": A2A_VERSION,
    ...headers,
  });
  res.end(payload);
}

/**
 * Extract text from A2A 0.3 message params.
 * @param {unknown} params
 */
export function extractMessageText(params) {
  if (!params || typeof params !== "object") return "";
  const p = /** @type {Record<string, unknown>} */ (params);
  const message = p.message && typeof p.message === "object" ? /** @type {Record<string, unknown>} */ (p.message) : p;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  /** @type {string[]} */
  const texts = [];
  for (const part of parts) {
    if (part && typeof part === "object") {
      const o = /** @type {Record<string, unknown>} */ (part);
      if (typeof o.text === "string") texts.push(o.text);
    }
  }
  if (texts.length) return texts.join("\n");
  if (typeof message.text === "string") return message.text;
  if (typeof p.text === "string") return p.text;
  return JSON.stringify(params);
}

/**
 * @param {object} opts
 * @param {import("node:http").IncomingMessage} opts.req
 * @param {import("node:http").ServerResponse} opts.res
 * @param {string} opts.role
 * @param {string} opts.hdcRoot
 * @param {string} opts.privateRoot
 * @param {ReturnType<import("./task-queue.mjs").createTaskQueue>} opts.queue
 * @param {(message: string, meta?: { litellmHeaders?: Record<string, string> }) => Promise<string>} opts.runTurn
 * @returns {Promise<boolean>}
 */
export async function handleA2aHttp(opts) {
  const { req, res, role, hdcRoot, queue, runTurn } = opts;
  const host = req.headers.host ?? `localhost:${process.env.HDC_AGENT_PORT || 9200}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const path = url.pathname;

  if (
    (path === "/.well-known/agent.json" ||
      path === "/.well-known/agent-card.json" ||
      path === "/a2a/agent-card") &&
    req.method === "GET"
  ) {
    jsonResponse(res, 200, buildAgentCard({ role, hostHeader: host, hdcRoot }));
    return true;
  }

  if (path === "/health" && req.method === "GET") {
    jsonResponse(res, 200, { ok: true, role, busy: queue.isBusy() });
    return true;
  }

  const isJsonRpc =
    (path === "/a2a" || path === "/a2a/" || path === "/a2a/message:send") && req.method === "POST";
  if (!isJsonRpc) return false;

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
      return true;
    }
    jsonResponse(res, 200, {
      jsonrpc: "2.0",
      id,
      result: toA2aTask(task),
    });
    return true;
  }

  if (method === "tasks/list") {
    jsonResponse(res, 200, {
      jsonrpc: "2.0",
      id,
      result: queue.list().map(toA2aTask),
    });
    return true;
  }

  if (method !== "message/send" && method !== "SendMessage") {
    jsonResponse(res, 200, {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not supported: ${method}` },
    });
    return true;
  }

  const text = extractMessageText(body.params);
  const taskId = randomUUID();
  const litellmHeaders = pickLitellmHeaders(req);

  queue.enqueue(taskId, text, async (msg) => runTurn(msg, { litellmHeaders }));

  const task = queue.get(taskId);
  jsonResponse(res, 200, {
    jsonrpc: "2.0",
    id,
    result: toA2aTask(task ?? { id: taskId, status: "submitted", message: text, createdAt: "", updatedAt: "" }),
  });
  return true;
}

/**
 * @param {import("node:http").IncomingMessage} req
 */
function pickLitellmHeaders(req) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!k.toLowerCase().startsWith("x-litellm-")) continue;
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v[0]) out[k] = String(v[0]);
  }
  return out;
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
