#!/usr/bin/env node
/**
 * hdc-agent-server — one container = one HDC_AGENT_ROLE.
 * Serves A2A 0.3 agent card + JSON-RPC; runs turns via LiteLLM + hdc-mcp-server handlers.
 * Scheduled ticks use the scripted dispatcher (LLM only when work is detected).
 */
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleA2aHttp } from "./lib/a2a-http.mjs";
import { createTaskQueue } from "./lib/task-queue.mjs";
import { runAgentTurn } from "./lib/agent-runner.mjs";
import { loadRolePrompt } from "./lib/role-prompt.mjs";
import { startScheduleLoop } from "./lib/schedule.mjs";
import { runDispatcher } from "./lib/dispatcher.mjs";
import { resolveAgentRole } from "../hdc-mcp-server/lib/policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const role = resolveAgentRole();
const port = Number(process.env.HDC_AGENT_PORT || process.env.PORT || 9200);
const hdcRoot = process.env.HDC_ROOT?.trim() || join(here, "..", "..");
const privateRoot = process.env.HDC_PRIVATE_ROOT?.trim() || "";

const queue = createTaskQueue();

async function runTurn(message, meta) {
  return runAgentTurn({
    role,
    message,
    hdcRoot,
    privateRoot,
    litellmHeaders: meta?.litellmHeaders ?? {},
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleA2aHttp({
      req,
      res,
      role,
      hdcRoot,
      privateRoot,
      queue,
      runTurn,
    });
    if (!handled) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[hdc-agent-server] error: ${msg}\n`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
  }
});

const prompt = loadRolePrompt(hdcRoot, role);
process.stderr.write(
  `[hdc-agent-server] role=${role} port=${port} prompt_chars=${prompt.length} private=${privateRoot ? "yes" : "no"}\n`,
);

server.listen(port, "0.0.0.0", () => {
  process.stderr.write(`[hdc-agent-server] listening on 0.0.0.0:${port}\n`);
  startScheduleLoop({
    role,
    runSweep: async () => {
      const result = await runDispatcher({
        role,
        hdcRoot,
        privateRoot,
      });
      if (!result.work.length) {
        process.stderr.write(
          `[hdc-agent-server] dispatcher idle: ${result.idle_reason || "no work"}\n`,
        );
        return;
      }
      for (const item of result.work) {
        if (item.peer_url) {
          process.stderr.write(`[hdc-agent-server] A2A delegate ${item.id} → ${item.peer_url}\n`);
          await postA2aMessage(item.peer_url, item.prompt);
          continue;
        }
        process.stderr.write(`[hdc-agent-server] enqueue LLM ${item.id}\n`);
        queue.enqueue(item.id, item.prompt, (msg) => runTurn(msg));
      }
    },
  });
});

/**
 * @param {string} baseUrl e.g. http://hdc-sre:9202
 * @param {string} text
 */
async function postA2aMessage(baseUrl, text) {
  const url = `${baseUrl.replace(/\/$/, "")}/a2a`;
  const body = {
    jsonrpc: "2.0",
    id: `dispatch-${Date.now()}`,
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ kind: "text", text }],
      },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`A2A peer ${url} → ${res.status}: ${t.slice(0, 300)}`);
  }
}
