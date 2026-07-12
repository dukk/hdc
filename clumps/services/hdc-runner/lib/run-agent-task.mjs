#!/usr/bin/env node
/**
 * Run a single agent task — installed at /opt/hdc-runner/bin/run-agent-task.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const META_ROOT = process.env.HDC_RUNNER_META_ROOT || "/opt/hdc-runner";
const INSTALL_ROOT = process.env.HDC_RUNNER_INSTALL_ROOT || "/opt/hdc";
const PRIVATE_ROOT = process.env.HDC_RUNNER_PRIVATE_ROOT || "/opt/hdc-private";

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val.slice(1, -1);
      }
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

async function main() {
  const taskId = process.argv[2]?.trim();
  const uiJobId = process.argv[3]?.trim() || null;
  if (!taskId) {
    process.stderr.write("usage: run-agent-task.mjs <task-id> [ui-job-id]\n");
    process.exit(2);
  }

  loadDotEnv(join(META_ROOT, ".env"));
  process.env.HDC_PRIVATE_ROOT = PRIVATE_ROOT;

  const apiKey = String(process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) {
    process.stderr.write("CURSOR_API_KEY not set\n");
    process.exit(1);
  }

  const tasksUrl = pathToFileURL(
    join(INSTALL_ROOT, "clumps/services/hdc-runner/lib/hdc-runner-tasks.mjs"),
  ).href;
  const agentRunUrl = pathToFileURL(
    join(INSTALL_ROOT, "clumps/services/hdc-runner/lib/hdc-runner-agent-run.mjs"),
  ).href;
  const jobsUrl = pathToFileURL(
    join(INSTALL_ROOT, "clumps/services/hdc-runner/lib/hdc-runner-ui-jobs.mjs"),
  ).href;

  const { readTask, writeTaskReport, listTasks } = await import(tasksUrl);
  const { runAgentForTask } = await import(agentRunUrl);
  const { completeJob } = await import(jobsUrl);

  const task = readTask(PRIVATE_ROOT, taskId);
  process.stderr.write(`[hdc-runner] agent task ${taskId} role=${task.role}\n`);

  const result = runAgentForTask({
    installRoot: INSTALL_ROOT,
    privateRoot: PRIVATE_ROOT,
    apiKey,
    role: task.role,
    taskId,
  });

  writeTaskReport(PRIVATE_ROOT, listTasks(PRIVATE_ROOT, { includeDone: true }), {
    source: uiJobId ? `ui-job-${uiJobId}` : "run-agent-task",
  });

  if (uiJobId) {
    completeJob(META_ROOT, uiJobId, { ok: result.ok, exitCode: result.exitCode });
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
