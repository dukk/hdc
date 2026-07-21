import { readTask } from "./operations-fs.mjs";
import { canAutoRunTask, peerA2aBaseUrl } from "./dispatcher.mjs";

/**
 * @param {{ id: string, role?: string, suggested_commands?: string[] }} task
 */
export function buildTaskExecutionPrompt(task) {
  return (
    `Execute task ${task.id}. Read operations/tasks/${task.id}.md. ` +
    `Set in_progress then done/blocked. Use hdc tools only. Suggested: ${(task.suggested_commands || []).join("; ") || "(see task body)"}.`
  );
}

/**
 * @param {{ id: string, role?: string, suggested_commands?: string[] }} task
 * @returns {{ id: string, local?: boolean, peer_url?: string, prompt: string } | null}
 */
export function buildTaskExecutionWorkItem(task) {
  const prompt = buildTaskExecutionPrompt(task);
  if (task.role === "hdc-manager") {
    return { id: `task-${task.id}`, local: true, prompt };
  }
  const peer = peerA2aBaseUrl(task.role);
  if (!peer) return null;
  return { id: `task-${task.id}`, peer_url: peer, prompt };
}

/**
 * @param {string} baseUrl e.g. http://hdc-sre-ops:9202
 * @param {string} text
 */
export async function postA2aMessage(baseUrl, text) {
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

/**
 * @param {object} opts
 * @param {string} opts.privateRoot
 * @param {string} opts.taskId
 * @param {(line: string) => void} [opts.log]
 */
export async function dispatchTaskById(opts) {
  const log = opts.log ?? (() => {});
  let task;
  try {
    task = readTask(opts.privateRoot, opts.taskId);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (task.status === "done" || task.status === "in_progress" || task.status === "blocked") {
    return {
      ok: false,
      message: `Task ${task.id} is ${task.status}`,
      status: task.status,
    };
  }

  if (!canAutoRunTask(task)) {
    return {
      ok: false,
      message: `Task ${task.id} is not auto-runnable (status=${task.status}, needs_decision=${task.needs_decision})`,
      status: task.status,
    };
  }

  const item = buildTaskExecutionWorkItem(task);
  if (!item) {
    return {
      ok: false,
      message: `No A2A peer URL for role ${task.role ?? "(missing)"}`,
    };
  }

  if (item.peer_url) {
    log(`[task-execution] A2A ${task.id} → ${item.peer_url}`);
    await postA2aMessage(item.peer_url, item.prompt);
    return {
      ok: true,
      task_id: task.id,
      dispatched: true,
      peer_url: item.peer_url,
    };
  }

  return {
    ok: true,
    task_id: task.id,
    dispatched: false,
    local: true,
    work_item: item,
  };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {NodeJS.ProcessEnv} [env]
 */
export function verifyInternalApiToken(req, env = process.env) {
  const expected = String(env.HDC_WEB_API_TOKEN ?? "").trim();
  if (!expected) return false;
  const auth = String(req.headers.authorization ?? "").trim();
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const token = auth.slice(7).trim();
  return token === expected;
}
