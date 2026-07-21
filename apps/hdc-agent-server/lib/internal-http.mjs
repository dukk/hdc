import { listTasks } from "./operations-fs.mjs";
import { notifyManagerDecision } from "./notify-manager.mjs";
import { loadDispatcherState, saveDispatcherState } from "./dispatcher.mjs";
import { dispatchTaskById, verifyInternalApiToken } from "./task-execution.mjs";
import {
  buildOperatorPromptMessage,
  enqueueOperatorPrompt,
} from "./operator-prompt.mjs";

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
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * @param {object} opts
 * @param {string} opts.privateRoot
 * @param {string} opts.hdcRoot
 * @param {(line: string) => void} [opts.log]
 */
export function scanPendingDecisionNotifications(opts) {
  const log = opts.log ?? (() => {});
  const tasks = listTasks(opts.privateRoot, { includeDone: true });
  const state = loadDispatcherState(opts.privateRoot);
  /** @type {string[]} */
  const legacyNotified = Array.isArray(state.discord_notified_ids)
    ? /** @type {string[]} */ (state.discord_notified_ids)
    : [];
  const notified = Array.isArray(state.notified_task_ids)
    ? /** @type {string[]} */ (state.notified_task_ids)
    : legacyNotified;
  const notifiedSet = new Set(notified);
  /** @type {string[]} */
  const newlyNotified = [];

  for (const t of tasks) {
    if (!t.needs_decision || t.status === "done") continue;
    if (notifiedSet.has(t.id)) continue;
    const msg = `Task ${t.id}: ${t.title}. Needs operator decision.`;
    const r = notifyManagerDecision(opts.hdcRoot, opts.privateRoot, "HDC decision needed", msg, t.id);
    if (r.ok) {
      notifiedSet.add(t.id);
      newlyNotified.push(t.id);
      log(`[internal] notified needs_decision for ${t.id}`);
    } else {
      log(`[internal] notify failed for ${t.id}: ${r.error || r.stderr || r.status}`);
    }
  }

  state.notified_task_ids = [...notifiedSet];
  delete state.discord_notified_ids;
  saveDispatcherState(opts.privateRoot, state);

  return { newly_notified: newlyNotified };
}

/**
 * @param {object} opts
 * @param {import("node:http").IncomingMessage} opts.req
 * @param {import("node:http").ServerResponse} opts.res
 * @param {string} opts.role
 * @param {string} opts.hdcRoot
 * @param {string} opts.privateRoot
 * @param {ReturnType<import("./task-queue.mjs").createTaskQueue>} opts.queue
 * @param {(message: string) => Promise<string>} opts.runTurn
 * @returns {Promise<boolean>}
 */
export async function handleInternalHttp(opts) {
  const { req, res, role, hdcRoot, privateRoot, queue, runTurn } = opts;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (!path.startsWith("/internal/")) return false;
  if (role !== "hdc-manager") {
    jsonResponse(res, 403, { error: "internal routes only on hdc-manager" });
    return true;
  }
  if (!verifyInternalApiToken(req)) {
    jsonResponse(res, 401, { error: "unauthorized" });
    return true;
  }
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return true;
  }

  if (path === "/internal/scan-decisions") {
    if (!privateRoot) {
      jsonResponse(res, 503, { error: "HDC_PRIVATE_ROOT unset" });
      return true;
    }
    const result = scanPendingDecisionNotifications({
      privateRoot,
      hdcRoot,
      log: (line) => process.stderr.write(`${line}\n`),
    });
    jsonResponse(res, 200, { ok: true, ...result });
    return true;
  }

  if (path === "/internal/dispatch-task") {
    if (!privateRoot) {
      jsonResponse(res, 503, { error: "HDC_PRIVATE_ROOT unset" });
      return true;
    }
    const body = await readJsonBody(req);
    const taskId = typeof body?.task_id === "string" ? body.task_id.trim() : "";
    if (!taskId) {
      jsonResponse(res, 400, { error: "task_id required" });
      return true;
    }
    const result = await dispatchTaskById({
      privateRoot,
      taskId,
      log: (line) => process.stderr.write(`${line}\n`),
    });
    if (!result.ok) {
      jsonResponse(res, 409, result);
      return true;
    }
    if (result.local && result.work_item) {
      queue.enqueue(result.work_item.id, result.work_item.prompt, (msg) => runTurn(msg));
      jsonResponse(res, 200, { ...result, enqueued: true });
      return true;
    }
    jsonResponse(res, 200, result);
    return true;
  }

  if (path === "/internal/operator-prompt") {
    const body = /** @type {Record<string, unknown>} */ (await readJsonBody(req));
    const operatorText =
      typeof body.prompt === "string"
        ? body.prompt.trim()
        : typeof body.text === "string"
          ? body.text.trim()
          : "";
    if (!operatorText) {
      jsonResponse(res, 400, { error: "prompt required" });
      return true;
    }
    const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
    const source = typeof body.source === "string" ? body.source.trim() : "slack";
    const slackUser =
      typeof body.slack_user === "string"
        ? body.slack_user.trim()
        : typeof body.user === "string"
          ? body.user.trim()
          : "";
    const replyObj =
      body.slack_reply && typeof body.slack_reply === "object"
        ? /** @type {Record<string, unknown>} */ (body.slack_reply)
        : {};
    const channel =
      typeof replyObj.channel === "string"
        ? replyObj.channel.trim()
        : typeof body.channel === "string"
          ? body.channel.trim()
          : "";
    const threadTs =
      typeof replyObj.thread_ts === "string"
        ? replyObj.thread_ts.trim()
        : typeof body.thread_ts === "string"
          ? body.thread_ts.trim()
          : "";

    const prompt = buildOperatorPromptMessage({
      operatorText,
      taskId,
      source,
      slackUser,
      channel,
    });
    const workId = taskId ? `operator-${taskId}` : undefined;
    const enqueued = enqueueOperatorPrompt({
      queue,
      runTurn,
      prompt,
      workId,
      slackReply: channel ? { channel, thread_ts: threadTs || undefined } : undefined,
      env: process.env,
      log: (line) => process.stderr.write(`${line}\n`),
    });
    jsonResponse(res, 202, { ok: true, ...enqueued, task_id: taskId || undefined });
    return true;
  }

  jsonResponse(res, 404, { error: "not found" });
  return true;
}
