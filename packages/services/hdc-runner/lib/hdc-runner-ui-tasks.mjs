import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createTask,
  listTasks,
  parseFrontmatter,
  readTask,
  readTaskReport,
  sanitizeTaskId,
  serializeTask,
  updateTaskStatus,
  validateTaskFrontmatter,
  writeTaskReport,
} from "./hdc-runner-tasks.mjs";

/**
 * @param {string} installRoot
 */
export function listAgentRoster(installRoot) {
  const agentsDir = join(installRoot, ".cursor", "agents");
  if (!existsSync(agentsDir)) return [];

  /** @type {Record<string, unknown>[]} */
  const agents = [];
  for (const name of readdirSync(agentsDir)) {
    if (!name.startsWith("hdc-") || !name.endsWith(".md")) continue;
    const raw = readFileSync(join(agentsDir, name), "utf8");
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    /** @type {Record<string, string>} */
    const meta = {};
    if (fmMatch) {
      for (const line of fmMatch[1].split(/\r?\n/)) {
        const m = line.match(/^([a-z_]+):\s*(.*)$/i);
        if (m) meta[m[1]] = m[2].trim();
      }
    }
    agents.push({
      id: name.replace(/\.md$/, ""),
      name: meta.name ?? name.replace(/\.md$/, ""),
      description: meta.description ?? "",
      readonly: meta.readonly === "true",
      is_background: meta.is_background === "true",
    });
  }
  return agents.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * @param {string} privateRoot
 */
export function getTasksApiPayload(privateRoot) {
  const tasks = listTasks(privateRoot, { includeDone: true });
  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      role: t.role,
      priority: t.priority,
      status: t.status,
      title: t.title,
      needs_decision: t.needs_decision,
      updated_at: t.updated_at,
      created_at: t.created_at,
    })),
  };
}

/**
 * @param {string} privateRoot
 * @param {string} id
 */
export function getTaskApiPayload(privateRoot, id) {
  const task = readTask(privateRoot, id);
  return { task, body: task.body };
}

/**
 * @param {string} privateRoot
 * @param {string} id
 * @param {Record<string, unknown>} body
 * @param {{ sessionOnly?: boolean; user?: string | null }} auth
 */
export function patchTaskApi(privateRoot, id, body, auth = {}) {
  if (auth.sessionOnly && auth.user === "api-token") {
    return { ok: false, status: 403, error: "session authentication required for task approval" };
  }

  sanitizeTaskId(id);
  /** @type {Partial<ReturnType<typeof validateTaskFrontmatter>>} */
  const patch = {};
  if (body.status !== undefined) patch.status = String(body.status);
  if (body.needs_decision !== undefined) patch.needs_decision = body.needs_decision === true;
  if (body.priority !== undefined) patch.priority = String(body.priority);
  if (body.blocked_reason !== undefined) patch.blocked_reason = String(body.blocked_reason);

  const task = updateTaskStatus(privateRoot, id, patch);
  writeTaskReport(privateRoot, listTasks(privateRoot, { includeDone: true }), {
    source: `ui-patch-${auth.user ?? "unknown"}`,
  });
  return { ok: true, status: 200, task };
}

/**
 * @param {string} privateRoot
 * @param {Record<string, unknown>} body
 */
export function createTaskFromMessage(privateRoot, body) {
  const text = String(body.text ?? body.message ?? "").trim();
  if (!text) return { ok: false, status: 400, error: "message text required" };

  const role = String(body.role ?? "hdc-manager").trim();
  const id =
    String(body.id ?? "").trim() ||
    `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-a2a-${Date.now()}`;

  const task = createTask(privateRoot, {
    id,
    role,
    priority: String(body.priority ?? "medium"),
    title: String(body.title ?? text.slice(0, 80)),
    needs_decision: body.needs_decision === true,
    body: text,
  });
  writeTaskReport(privateRoot, listTasks(privateRoot, { includeDone: true }), { source: "a2a-message" });
  return { ok: true, status: 201, task };
}

export { readTaskReport, listTasks, createTask, parseFrontmatter, serializeTask };
