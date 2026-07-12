import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  appendFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const MAX_JOB_LOG = 512 * 1024;

/**
 * @param {string} metaRoot
 */
export function jobsDir(metaRoot) {
  return join(metaRoot, "jobs");
}

/**
 * @param {string} metaRoot
 */
export function activeJobPath(metaRoot) {
  return join(jobsDir(metaRoot), "active.json");
}

/**
 * @param {string} metaRoot
 */
export function ensureJobsDir(metaRoot) {
  const dir = jobsDir(metaRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} metaRoot
 */
export function readActiveJob(metaRoot) {
  const path = activeJobPath(metaRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} metaRoot
 * @param {Record<string, unknown> | null} active
 */
export function writeActiveJob(metaRoot, active) {
  ensureJobsDir(metaRoot);
  const path = activeJobPath(metaRoot);
  if (!active) {
    if (existsSync(path)) writeFileSync(path, "{}", "utf8");
    return;
  }
  writeFileSync(path, JSON.stringify(active, null, 2), "utf8");
}

/**
 * @param {string} metaRoot
 */
export function isJobRunning(metaRoot) {
  const active = readActiveJob(metaRoot);
  if (!active || !active.pid) return false;
  try {
    process.kill(Number(active.pid), 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} metaRoot
 * @param {number} maxConcurrent
 */
export function canStartJob(metaRoot, maxConcurrent) {
  if (maxConcurrent <= 0) return true;
  return !isJobRunning(metaRoot);
}

/**
 * @param {string} metaRoot
 * @param {Record<string, unknown>} job
 */
export function writeJobMeta(metaRoot, job) {
  ensureJobsDir(metaRoot);
  writeFileSync(join(jobsDir(metaRoot), `${job.id}.json`), JSON.stringify(job, null, 2), "utf8");
}

/**
 * @param {string} metaRoot
 * @param {string} jobId
 */
export function readJobMeta(metaRoot, jobId) {
  const path = join(jobsDir(metaRoot), `${jobId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} metaRoot
 */
export function listJobs(metaRoot) {
  ensureJobsDir(metaRoot);
  const dir = jobsDir(metaRoot);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "active.json");
  /** @type {Record<string, unknown>[]} */
  const jobs = [];
  for (const f of files) {
    try {
      jobs.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch {
      /* skip */
    }
  }
  jobs.sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
  return jobs.slice(0, 50);
}

/**
 * @param {string} metaRoot
 * @param {string} jobId
 */
export function readJobLog(metaRoot, jobId) {
  const logPath = join(jobsDir(metaRoot), `${jobId}.log`);
  if (!existsSync(logPath)) return { text: "", bytes: 0 };
  const st = statSync(logPath);
  const full = readFileSync(logPath, "utf8");
  const text = full.length > MAX_JOB_LOG ? full.slice(-MAX_JOB_LOG) : full;
  return { text, bytes: st.size, truncated: full.length > MAX_JOB_LOG };
}

/**
 * @param {object} opts
 * @param {string} opts.metaRoot
 * @param {string} opts.installRoot
 * @param {string} opts.type
 * @param {string} [opts.scheduleId]
 * @param {string} [opts.tier]
 * @param {string} [opts.package]
 * @param {string} [opts.verb]
 * @param {string[]} [opts.args]
 */
export function spawnJob(opts) {
  const jobId = randomUUID();
  const logPath = join(jobsDir(opts.metaRoot), `${jobId}.log`);
  ensureJobsDir(opts.metaRoot);

  /** @type {Record<string, unknown>} */
  const meta = {
    id: jobId,
    type: opts.type,
    schedule_id: opts.scheduleId ?? null,
    tier: opts.tier ?? null,
    package: opts.package ?? null,
    verb: opts.verb ?? null,
    args: opts.args ?? [],
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    exit_code: null,
    log_path: logPath,
  };
  writeJobMeta(opts.metaRoot, meta);

  let scriptPath;
  /** @type {string[]} */
  let scriptArgs;
  if (opts.type === "schedule") {
    scriptPath = join(opts.metaRoot, "bin/run-scheduled-job.mjs");
    scriptArgs = [scriptPath, String(opts.scheduleId), jobId];
  } else {
    scriptPath = join(opts.metaRoot, "bin/run-adhoc-job.mjs");
    scriptArgs = [scriptPath, jobId];
  }

  appendFileSync(logPath, `=== ${meta.started_at} job ${jobId} started ===\n`, "utf8");

  const child = spawn(process.execPath, scriptArgs, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: process.env,
  });
  child.unref();

  meta.pid = child.pid;
  writeJobMeta(opts.metaRoot, meta);
  writeActiveJob(opts.metaRoot, { id: jobId, pid: child.pid, type: opts.type, started_at: meta.started_at });

  return { jobId, pid: child.pid };
}

/**
 * @param {string} metaRoot
 * @param {string} jobId
 * @param {{ ok?: boolean; exitCode?: number }} result
 */
export function completeJob(metaRoot, jobId, result) {
  const ok = result.ok === true;
  const exitCode = result.exitCode ?? (ok ? 0 : 1);
  const current = readJobMeta(metaRoot, jobId) ?? { id: jobId };
  writeJobMeta(metaRoot, {
    ...current,
    id: jobId,
    status: ok ? "completed" : "failed",
    exit_code: exitCode,
    finished_at: new Date().toISOString(),
  });
  writeActiveJob(metaRoot, null);
}

/**
 * @param {object} opts
 * @param {string} opts.metaRoot
 * @param {string} opts.installRoot
 * @param {string} opts.taskId
 */
export function spawnAgentTaskJob(opts) {
  const jobId = randomUUID();
  const logPath = join(jobsDir(opts.metaRoot), `${jobId}.log`);
  ensureJobsDir(opts.metaRoot);

  /** @type {Record<string, unknown>} */
  const meta = {
    id: jobId,
    type: "agent-task",
    task_id: opts.taskId,
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    exit_code: null,
    log_path: logPath,
  };
  writeJobMeta(opts.metaRoot, meta);

  const scriptPath = join(opts.metaRoot, "bin/run-agent-task.mjs");
  const scriptArgs = [scriptPath, opts.taskId, jobId];
  appendFileSync(logPath, `=== ${meta.started_at} agent-task ${opts.taskId} started ===\n`, "utf8");

  const child = spawn(process.execPath, scriptArgs, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: process.env,
    cwd: opts.installRoot,
  });
  child.unref();

  meta.pid = child.pid;
  writeJobMeta(opts.metaRoot, meta);
  writeActiveJob(opts.metaRoot, {
    id: jobId,
    pid: child.pid,
    type: "agent-task",
    started_at: meta.started_at,
  });

  return { jobId, pid: child.pid };
}

export { MAX_JOB_LOG };
