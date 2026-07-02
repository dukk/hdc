import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildAgentPrompt,
  loadManagerTriageInstructions,
  runAgentForTask,
  runCursorAgent,
} from "./hdc-runner-agent-run.mjs";
import { listTasks, writeTaskReport } from "./hdc-runner-tasks.mjs";

/**
 * Tasks the manager may auto-run without operator approval (query-only suggestions).
 *
 * @param {ReturnType<typeof import("./hdc-runner-tasks.mjs").validateTaskFrontmatter>} task
 */
export function canAutoRunTask(task) {
  if (task.status !== "pending" && task.status !== "approved") return false;
  if (task.status === "approved") return true;
  if (task.needs_decision) return false;
  const cmds = task.suggested_commands ?? [];
  if (!cmds.length) return false;
  return cmds.every((c) => /\bquery\b/.test(c) && !/\b(deploy|teardown|prune)\b/.test(c));
}

/**
 * @param {object} opts
 * @param {string} opts.installRoot
 * @param {string} opts.privateRoot
 * @param {string} opts.apiKey
 * @param {number} [opts.maxConcurrent]
 * @param {string} [opts.source]
 */
export async function runManagerCycle(opts) {
  const maxConcurrent = opts.maxConcurrent ?? 1;
  const source = opts.source ?? "agent-manager-hourly";
  const managerLog = `/var/log/hdc-runner/agents/manager-${Date.now()}.log`;

  const triageInstructions = loadManagerTriageInstructions(opts.installRoot);
  const managerPrompt = buildAgentPrompt({
    installRoot: opts.installRoot,
    privateRoot: opts.privateRoot,
    role: "hdc-manager",
    instructions: `${triageInstructions}\n\nAfter triage, ensure operations/task-report.md reflects current tasks.`,
  });

  const managerResult = runCursorAgent({
    workspace: opts.installRoot,
    apiKey: opts.apiKey,
    role: "hdc-manager",
    prompt: managerPrompt,
    logPath: managerLog,
  });

  let tasks = listTasks(opts.privateRoot, { includeDone: true });
  writeTaskReport(opts.privateRoot, tasks, { source });

  /** @type {import("./hdc-runner-agent-run.mjs").runAgentForTask extends (...args: infer A) => infer R ? R : never}[]} */
  const workerResults = [];
  const runnable = tasks.filter((t) => canAutoRunTask(t) || t.status === "approved");
  let started = 0;

  for (const task of runnable) {
    if (started >= maxConcurrent) break;
    if (task.status === "done" || task.status === "in_progress" || task.status === "blocked") {
      continue;
    }
    started += 1;
    const wr = runAgentForTask({
      installRoot: opts.installRoot,
      privateRoot: opts.privateRoot,
      apiKey: opts.apiKey,
      role: task.role,
      taskId: task.id,
    });
    workerResults.push({ task_id: task.id, ...wr });
  }

  tasks = listTasks(opts.privateRoot, { includeDone: true });
  const reportPath = writeTaskReport(opts.privateRoot, tasks, { source });

  const date = new Date().toISOString().slice(0, 10);
  const digestPath = join(opts.privateRoot, "operations", "reports", `manager-triage-${date}.md`);
  const digest = [
    `# Manager triage ${date}`,
    "",
    `Source: ${source}`,
    `Manager exit: ${managerResult.exitCode}`,
    `Workers started: ${workerResults.length}`,
    `Task report: ${reportPath}`,
    "",
    "## Open tasks",
    ...tasks
      .filter((t) => t.status !== "done")
      .map((t) => `- **${t.id}** (${t.priority}/${t.status}) — ${t.title}`),
    "",
  ].join("\n");
  writeFileSync(digestPath, digest, "utf8");

  return {
    ok: managerResult.ok && workerResults.every((w) => w.ok),
    manager: managerResult,
    workers: workerResults,
    report_path: reportPath,
    digest_path: digestPath,
  };
}
