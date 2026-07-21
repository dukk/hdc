import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** @typedef {"pending"|"approved"|"in_progress"|"blocked"|"done"} TaskStatus */
/** @typedef {"critical"|"high"|"medium"|"low"} TaskPriority */
/** @typedef {"pending"|"in_progress"|"completed"|"failed"} DelegationStatus */

export const TASK_STATUSES = /** @type {const} */ ([
  "pending",
  "approved",
  "in_progress",
  "blocked",
  "done",
]);

export const TASK_PRIORITIES = /** @type {const} */ ([
  "critical",
  "high",
  "medium",
  "low",
]);

export const TASK_ROLES = /** @type {const} */ ([
  "hdc-manager",
  "hdc-sre-ops",
  "hdc-sre-engineer",
  "hdc-monitor",
  "hdc-maintainer",
  "hdc-security-expert",
  "hdc-security-architect",
  "hdc-network-architect",
  "hdc-research",
  "hdc-qa",
]);

export const DELEGATION_STATUSES = /** @type {const} */ ([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

/** @typedef {"hdc-manager"|"hdc-sre-ops"|"hdc-sre-engineer"|"hdc-monitor"|"hdc-maintainer"|"hdc-security-expert"|"hdc-security-architect"|"hdc-network-architect"|"hdc-research"|"hdc-qa"} TaskRole */

export const TASKS_DIR = "operations/tasks";
export const TASK_REPORT_REL = "operations/task-report.md";

/**
 * @param {string} privateRoot
 */
export function tasksDir(privateRoot) {
  return join(privateRoot, TASKS_DIR);
}

/**
 * @param {string} privateRoot
 */
export function taskReportPath(privateRoot) {
  return join(privateRoot, TASK_REPORT_REL);
}

/**
 * @param {string} id
 */
export function sanitizeTaskId(id) {
  const s = String(id ?? "").trim();
  if (!s || !/^[a-z0-9][a-z0-9._-]*$/i.test(s)) {
    throw new Error(`invalid task id: ${JSON.stringify(id)}`);
  }
  return s;
}

/**
 * @param {string} id
 */
export function taskFilePath(privateRoot, id) {
  return join(tasksDir(privateRoot), `${sanitizeTaskId(id)}.md`);
}

/**
 * Parse simple YAML frontmatter (no external deps).
 *
 * @param {string} raw
 */
export function parseFrontmatter(raw) {
  const text = String(raw ?? "");
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { meta: {}, body: text.trim() };
  }
  const end = text.indexOf("\n---", 4);
  if (end < 0) {
    return { meta: {}, body: text.trim() };
  }
  const yamlBlock = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, "").trim();
  /** @type {Record<string, unknown>} */
  const meta = {};
  /** @type {string | null} */
  let currentKey = null;
  /** @type {unknown[]} */
  let currentList = [];

  for (const line of yamlBlock.split(/\r?\n/)) {
    const normalized = line.replace(/\r$/, "");
    const trimmed = normalized.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const listMatch = normalized.match(/^(\s*)-\s+(.*)$/);
    if (listMatch && currentKey) {
      let val = listMatch[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      currentList.push(val);
      meta[currentKey] = [...currentList];
      continue;
    }

    const kv = trimmed.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (!kv) continue;
    currentKey = kv[1];
    currentList = [];
    let val = kv[2].trim();
    if (val === "") {
      meta[currentKey] = [];
      continue;
    }
    if (val === "true") meta[currentKey] = true;
    else if (val === "false") meta[currentKey] = false;
    else if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      meta[currentKey] = val.slice(1, -1);
    } else {
      meta[currentKey] = val;
    }
  }

  return { meta, body };
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function stringList(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * @param {Record<string, unknown>} meta
 * @param {string} body
 */
export function validateTaskFrontmatter(meta, body = "") {
  const id = String(meta.id ?? "").trim();
  if (!id) throw new Error("task frontmatter: id is required");

  const role = String(meta.role ?? "").trim();
  if (!TASK_ROLES.includes(/** @type {TaskRole} */ (role))) {
    throw new Error(`task frontmatter: invalid role ${JSON.stringify(role)}`);
  }

  const status = String(meta.status ?? "pending").trim();
  if (!TASK_STATUSES.includes(/** @type {TaskStatus} */ (status))) {
    throw new Error(`task frontmatter: invalid status ${JSON.stringify(status)}`);
  }

  const priority = String(meta.priority ?? "medium").trim();
  if (!TASK_PRIORITIES.includes(/** @type {TaskPriority} */ (priority))) {
    throw new Error(`task frontmatter: invalid priority ${JSON.stringify(priority)}`);
  }

  return {
    id,
    role: /** @type {TaskRole} */ (role),
    status: /** @type {TaskStatus} */ (status),
    priority: /** @type {TaskPriority} */ (priority),
    title: String(meta.title ?? id).trim() || id,
    created_at: String(meta.created_at ?? new Date().toISOString()).trim(),
    updated_at: String(meta.updated_at ?? new Date().toISOString()).trim(),
    needs_decision: meta.needs_decision === true,
    assigned_by:
      typeof meta.assigned_by === "string" && meta.assigned_by.trim()
        ? meta.assigned_by.trim()
        : undefined,
    evidence: stringList(meta.evidence),
    suggested_commands: stringList(meta.suggested_commands),
    approved_at:
      typeof meta.approved_at === "string" && meta.approved_at.trim()
        ? meta.approved_at.trim()
        : undefined,
    completed_at:
      typeof meta.completed_at === "string" && meta.completed_at.trim()
        ? meta.completed_at.trim()
        : undefined,
    blocked_reason:
      typeof meta.blocked_reason === "string" && meta.blocked_reason.trim()
        ? meta.blocked_reason.trim()
        : undefined,
    parent_task_id:
      typeof meta.parent_task_id === "string" && meta.parent_task_id.trim()
        ? meta.parent_task_id.trim()
        : undefined,
    delegated_to:
      typeof meta.delegated_to === "string" && meta.delegated_to.trim()
        ? meta.delegated_to.trim()
        : undefined,
    delegation_status: (() => {
      const raw = typeof meta.delegation_status === "string" ? meta.delegation_status.trim() : "";
      if (!raw) return undefined;
      if (!DELEGATION_STATUSES.includes(/** @type {DelegationStatus} */ (raw))) {
        throw new Error(`task frontmatter: invalid delegation_status ${JSON.stringify(raw)}`);
      }
      return /** @type {DelegationStatus} */ (raw);
    })(),
    augmentor_run_id:
      typeof meta.augmentor_run_id === "string" && meta.augmentor_run_id.trim()
        ? meta.augmentor_run_id.trim()
        : undefined,
    run_log:
      typeof meta.run_log === "string" && meta.run_log.trim() ? meta.run_log.trim() : undefined,
    body: String(body ?? "").trim(),
  };
}

/**
 * @param {ReturnType<typeof validateTaskFrontmatter>} task
 */
export function serializeTask(task) {
  /** @type {string[]} */
  const lines = ["---"];
  lines.push(`id: ${task.id}`);
  lines.push(`role: ${task.role}`);
  lines.push(`priority: ${task.priority}`);
  lines.push(`status: ${task.status}`);
  lines.push(`title: ${JSON.stringify(task.title)}`);
  lines.push(`created_at: ${task.created_at}`);
  lines.push(`updated_at: ${task.updated_at}`);
  lines.push(`needs_decision: ${task.needs_decision ? "true" : "false"}`);
  if (task.assigned_by) lines.push(`assigned_by: ${task.assigned_by}`);
  if (task.approved_at) lines.push(`approved_at: ${task.approved_at}`);
  if (task.completed_at) lines.push(`completed_at: ${task.completed_at}`);
  if (task.blocked_reason) lines.push(`blocked_reason: ${JSON.stringify(task.blocked_reason)}`);
  if (task.parent_task_id) lines.push(`parent_task_id: ${task.parent_task_id}`);
  if (task.delegated_to) lines.push(`delegated_to: ${task.delegated_to}`);
  if (task.delegation_status) lines.push(`delegation_status: ${task.delegation_status}`);
  if (task.augmentor_run_id) lines.push(`augmentor_run_id: ${task.augmentor_run_id}`);
  if (task.run_log) lines.push(`run_log: ${task.run_log}`);
  if (task.evidence.length) {
    lines.push("evidence:");
    for (const e of task.evidence) lines.push(`  - ${e}`);
  }
  if (task.suggested_commands.length) {
    lines.push("suggested_commands:");
    for (const c of task.suggested_commands) lines.push(`  - ${JSON.stringify(c)}`);
  }
  lines.push("---");
  if (task.body) {
    lines.push("");
    lines.push(task.body);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {string} privateRoot
 * @param {{ includeDone?: boolean }} [opts]
 */
export function listTasks(privateRoot, opts = {}) {
  const dir = tasksDir(privateRoot);
  if (!existsSync(dir)) return [];

  /** @type {ReturnType<typeof validateTaskFrontmatter>[]} */
  const tasks = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    try {
      const task = readTask(privateRoot, name.replace(/\.md$/, ""));
      if (!opts.includeDone && task.status === "done") continue;
      tasks.push(task);
    } catch {
      /* skip invalid files */
    }
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => {
    const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pd !== 0) return pd;
    return a.updated_at.localeCompare(b.updated_at);
  });
  return tasks;
}

/**
 * @param {string} privateRoot
 * @param {string} id
 */
export function readTask(privateRoot, id) {
  const path = taskFilePath(privateRoot, id);
  if (!existsSync(path)) {
    throw new Error(`task not found: ${id}`);
  }
  const raw = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return validateTaskFrontmatter(meta, body);
}

/**
 * @param {string} privateRoot
 * @param {ReturnType<typeof validateTaskFrontmatter>} task
 */
export function writeTask(privateRoot, task) {
  const validated = validateTaskFrontmatter(
    {
      ...task,
      updated_at: task.updated_at || new Date().toISOString(),
    },
    task.body,
  );
  const dir = tasksDir(privateRoot);
  mkdirSync(dir, { recursive: true });
  const path = taskFilePath(privateRoot, validated.id);
  writeFileSync(path, serializeTask(validated), "utf8");
  return validated;
}

/**
 * @param {string} privateRoot
 * @param {string} id
 * @param {Partial<ReturnType<typeof validateTaskFrontmatter>>} patch
 */
export function updateTaskStatus(privateRoot, id, patch) {
  const current = readTask(privateRoot, id);
  const next = validateTaskFrontmatter(
    {
      ...current,
      ...patch,
      id: current.id,
      updated_at: new Date().toISOString(),
    },
    patch.body !== undefined ? patch.body : current.body,
  );
  if (next.status === "approved" && !next.approved_at) {
    next.approved_at = next.updated_at;
  }
  if (next.status === "done" && !next.completed_at) {
    next.completed_at = next.updated_at;
  }
  return writeTask(privateRoot, next);
}

/**
 * @param {ReturnType<typeof validateTaskFrontmatter>[]} tasks
 * @param {{ source?: string; now?: string }} [opts]
 */
export function renderTaskReport(tasks, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const source = opts.source ?? "hdc-manager";
  /** @type {Record<string, number>} */
  const counts = {};
  for (const s of TASK_STATUSES) counts[s] = 0;
  let done7d = 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const t of tasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
    if (t.status === "done" && t.completed_at) {
      const ts = Date.parse(t.completed_at);
      if (!Number.isNaN(ts) && ts >= weekAgo) done7d += 1;
    }
  }

  const open = tasks.filter((t) => t.status !== "done");
  /** @type {string[]} */
  const lines = [
    "# HDC Task Report",
    "",
    `Last updated: ${now} (${source})`,
    "",
    "| ID | Role | Priority | Status | Title | Updated |",
    "|----|------|----------|--------|-------|---------|",
  ];

  for (const t of open) {
    const title = t.title.replace(/\|/g, "\\|");
    lines.push(`| ${t.id} | ${t.role} | ${t.priority} | ${t.status} | ${title} | ${t.updated_at} |`);
  }

  if (open.length === 0) {
    lines.push("| _none_ | | | | | |");
  }

  lines.push("");
  lines.push("## Counts");
  lines.push(
    `pending: ${counts.pending} · approved: ${counts.approved} · in_progress: ${counts.in_progress} · blocked: ${counts.blocked} · done (7d): ${done7d}`,
  );
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {string} privateRoot
 * @param {ReturnType<typeof validateTaskFrontmatter>[]} tasks
 * @param {{ source?: string }} [opts]
 */
export function writeTaskReport(privateRoot, tasks, opts = {}) {
  const md = renderTaskReport(tasks, opts);
  const path = taskReportPath(privateRoot);
  mkdirSync(join(privateRoot, "operations"), { recursive: true });
  writeFileSync(path, md, "utf8");
  return path;
}

/**
 * @param {string} privateRoot
 */
export function readTaskReport(privateRoot) {
  const path = taskReportPath(privateRoot);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/**
 * @param {string} privateRoot
 * @param {Partial<ReturnType<typeof validateTaskFrontmatter>> & { id: string }} input
 */
export function createTask(privateRoot, input) {
  const now = new Date().toISOString();
  const task = validateTaskFrontmatter(
    {
      status: "pending",
      priority: "medium",
      needs_decision: false,
      created_at: now,
      updated_at: now,
      title: input.id,
      evidence: [],
      suggested_commands: [],
      ...input,
    },
    input.body ?? "",
  );
  return writeTask(privateRoot, task);
}
