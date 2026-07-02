import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  createTaskFromMessage,
  getTaskApiPayload,
  getTasksApiPayload,
  listAgentRoster,
  patchTaskApi,
  readTaskReport,
} from "./hdc-runner-ui-tasks.mjs";
import { readTask, sanitizeTaskId } from "./hdc-runner-tasks.mjs";

const A2A_VERSION = "0.3.0";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {string} hostHeader
 * @param {string} installRoot
 */
export function buildAgentCard(req, hostHeader, installRoot) {
  const host = hostHeader?.split(":")[0] ?? "localhost";
  const port = hostHeader?.includes(":") ? hostHeader.split(":")[1] : "9120";
  const baseUrl = `http://${host}:${port}`;
  const agents = listAgentRoster(installRoot);

  return {
    name: "hdc-agent-team",
    description: "HDC home data center agent team — manager, monitor, SRE, security, research",
    version: A2A_VERSION,
    protocolVersion: A2A_VERSION,
    url: `${baseUrl}/a2a`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills: agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
    })),
    supportedInterfaces: [
      {
        url: `${baseUrl}/a2a`,
        protocolBinding: "HTTP+JSON",
      },
    ],
  };
}

/**
 * Handle A2A and agent discovery routes.
 *
 * @param {object} ctx
 * @param {import("node:http").IncomingMessage} ctx.req
 * @param {import("node:http").ServerResponse} ctx.res
 * @param {URL} ctx.url
 * @param {string} ctx.privateRoot
 * @param {string} ctx.installRoot
 * @param {string | null} ctx.user
 * @param {(res: import("node:http").ServerResponse, status: number, body: unknown, headers?: Record<string, string>) => void} ctx.jsonResponse
 * @param {(req: import("node:http").IncomingMessage) => Promise<unknown>} ctx.readJsonBody
 * @returns {Promise<boolean>} true if handled
 */
export async function handleA2aRequest(ctx) {
  const { req, res, url, privateRoot, installRoot, user, jsonResponse, readJsonBody } = ctx;
  const path = url.pathname;

  if (path === "/.well-known/agent.json" && req.method === "GET") {
    jsonResponse(res, 200, buildAgentCard(req, req.headers.host ?? "localhost", installRoot), {
      "A2A-Version": A2A_VERSION,
    });
    return true;
  }

  if (!path.startsWith("/a2a")) return false;

  if (path === "/a2a/agent-card" && req.method === "GET") {
    jsonResponse(res, 200, buildAgentCard(req, req.headers.host ?? "localhost", installRoot), {
      "A2A-Version": A2A_VERSION,
    });
    return true;
  }

  const needsAuth = path !== "/a2a/agent-card";
  if (needsAuth && !user) {
    jsonResponse(res, 401, { error: "authentication required" }, { "A2A-Version": A2A_VERSION });
    return true;
  }

  if (path === "/a2a/agents" && req.method === "GET") {
    jsonResponse(
      res,
      200,
      { agents: listAgentRoster(installRoot) },
      { "A2A-Version": A2A_VERSION },
    );
    return true;
  }

  if (path === "/a2a/tasks" && req.method === "GET") {
    jsonResponse(res, 200, getTasksApiPayload(privateRoot), { "A2A-Version": A2A_VERSION });
    return true;
  }

  const taskMatch = path.match(/^\/a2a\/tasks\/([^/]+)$/);
  if (taskMatch && req.method === "GET") {
    try {
      const id = decodeURIComponent(taskMatch[1]);
      jsonResponse(res, 200, getTaskApiPayload(privateRoot, id), { "A2A-Version": A2A_VERSION });
    } catch (e) {
      jsonResponse(res, 404, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  if (path === "/a2a/message:send" && req.method === "POST") {
    try {
      const body = /** @type {Record<string, unknown>} */ (await readJsonBody(req));
      if (body.task_id) {
        const taskId = sanitizeTaskId(String(body.task_id));
        const task = readTask(privateRoot, taskId);
        jsonResponse(
          res,
          200,
          {
            task,
            action: "run_requested",
            hint: `POST /api/tasks/${taskId}/run to execute`,
          },
          { "A2A-Version": A2A_VERSION },
        );
        return true;
      }
      const created = createTaskFromMessage(privateRoot, body);
      if (!created.ok) {
        jsonResponse(res, created.status ?? 400, { error: created.error });
        return true;
      }
      jsonResponse(res, created.status ?? 201, { task: created.task }, { "A2A-Version": A2A_VERSION });
    } catch (e) {
      jsonResponse(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  jsonResponse(res, 404, { error: "not found" }, { "A2A-Version": A2A_VERSION });
  return true;
}
