#!/usr/bin/env node
/**
 * hdc-agent-server — one container = one HDC_AGENT_ROLE.
 * Serves A2A 0.3 agent card + JSON-RPC; runs turns via LiteLLM + hdc-mcp handlers.
 */
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleA2aHttp } from "./lib/a2a-http.mjs";
import { createTaskQueue } from "./lib/task-queue.mjs";
import { runAgentTurn } from "./lib/agent-runner.mjs";
import { loadRolePrompt } from "./lib/role-prompt.mjs";
import { defaultSweepPrompt, startScheduleLoop } from "./lib/schedule.mjs";
import { resolveAgentRole } from "../hdc-mcp/lib/policy.mjs";

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
      const id = `sched-${Date.now()}`;
      process.stderr.write(`[hdc-agent-server] schedule tick ${id}\n`);
      queue.enqueue(id, defaultSweepPrompt(role), (msg) => runTurn(msg));
    },
  });
});
