import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  appendFileSync,
  statSync,
  openSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { loadSchedulesFile } from "./schedules.mjs";
import { sanitizeScheduleId } from "./log-parse.mjs";

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
 * @param {string} installRoot
 * @param {string[]} cliArgs hdc argv after cli.mjs (e.g. ["run","service","bind","query"])
 * @param {object} opts
 * @param {string} opts.metaRoot
 * @param {string} opts.privateRoot
 * @param {string} opts.logPath
 * @param {string} opts.jobId
 * @param {Record<string, unknown>} opts.meta
 */
function spawnHdcCli(installRoot, cliArgs, opts) {
  const cliPath = join(installRoot, "apps", "hdc-cli", "cli.mjs");
  const fd = openSync(opts.logPath, "a");
  const child = spawn(process.execPath, [cliPath, ...cliArgs], {
    cwd: installRoot,
    stdio: ["ignore", fd, fd],
    env: {
      ...process.env,
      HDC_PRIVATE_ROOT: opts.privateRoot,
      HDC_ROOT: installRoot,
    },
    windowsHide: true,
  });
  child.on("close", (code) => {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    const finished = new Date().toISOString();
    appendFileSync(opts.logPath, `\n--- ${finished} exit=${code ?? 1} ---\n`, "utf8");
    completeJob(opts.metaRoot, opts.jobId, { ok: code === 0, exitCode: code ?? 1 });
  });
  child.on("error", (err) => {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    appendFileSync(opts.logPath, `\nspawn error: ${err.message}\n`, "utf8");
    completeJob(opts.metaRoot, opts.jobId, { ok: false, exitCode: 1 });
  });
  return child;
}

/**
 * @param {object} opts
 * @param {string} opts.metaRoot
 * @param {string} opts.installRoot
 * @param {string} opts.privateRoot
 * @param {string} [opts.logDir]
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
  appendFileSync(logPath, `=== ${meta.started_at} job ${jobId} started ===\n`, "utf8");

  /** @type {string[]} */
  let cliArgs = [];
  if (opts.type === "schedule") {
    const schedules = loadSchedulesFile(opts.metaRoot);
    const id = sanitizeScheduleId(String(opts.scheduleId));
    const found = schedules.find((s) => sanitizeScheduleId(String(s?.id ?? "")) === id);
    if (!found) {
      appendFileSync(logPath, `schedule not found: ${id}\n`, "utf8");
      completeJob(opts.metaRoot, jobId, { ok: false, exitCode: 1 });
      return { jobId, pid: null };
    }
    const cli = Array.isArray(found.cli) ? found.cli.map(String) : [];
    const extra = Array.isArray(found.cli_args) ? found.cli_args.map(String) : [];
    if (cli[0] === "run-daily") {
      const runDailyCandidates = [
        join(opts.installRoot, "apps", "hdc-agent-server", "bin", "run-daily.mjs"),
      ];
      const runDaily = runDailyCandidates.find((p) => existsSync(p));
      if (runDaily) {
        const fd = openSync(logPath, "a");
        const child = spawn(process.execPath, [runDaily, ...extra], {
          cwd: opts.installRoot,
          stdio: ["ignore", fd, fd],
          env: { ...process.env, HDC_PRIVATE_ROOT: opts.privateRoot, HDC_ROOT: opts.installRoot },
          windowsHide: true,
        });
        child.on("close", (code) => {
          try {
            closeSync(fd);
          } catch {
            /* ignore */
          }
          appendFileSync(logPath, `\n--- ${new Date().toISOString()} exit=${code ?? 1} ---\n`, "utf8");
          completeJob(opts.metaRoot, jobId, { ok: code === 0, exitCode: code ?? 1 });
        });
        meta.pid = child.pid;
        writeJobMeta(opts.metaRoot, meta);
        writeActiveJob(opts.metaRoot, {
          id: jobId,
          pid: child.pid,
          type: opts.type,
          started_at: meta.started_at,
        });
        return { jobId, pid: child.pid };
      }
      appendFileSync(logPath, `run-daily.mjs not found under apps/hdc-agent-server\n`, "utf8");
      completeJob(opts.metaRoot, jobId, { ok: false, exitCode: 1 });
      return { jobId, pid: null };
    }
    if (cli.length) {
      cliArgs = extra.length ? [...cli, "--", ...extra] : [...cli];
    } else if (!cliArgs.length) {
      appendFileSync(logPath, `unsupported schedule cli: ${JSON.stringify(cli)}\n`, "utf8");
      completeJob(opts.metaRoot, jobId, { ok: false, exitCode: 1 });
      return { jobId, pid: null };
    }
  } else {
    const args = opts.args ?? [];
    cliArgs = ["run", String(opts.tier), String(opts.package), String(opts.verb)];
    if (args.length) cliArgs.push("--", ...args);
  }

  const child = spawnHdcCli(opts.installRoot, cliArgs, {
    metaRoot: opts.metaRoot,
    privateRoot: opts.privateRoot,
    logPath,
    jobId,
    meta,
  });

  meta.pid = child.pid;
  writeJobMeta(opts.metaRoot, meta);
  writeActiveJob(opts.metaRoot, {
    id: jobId,
    pid: child.pid,
    type: opts.type,
    started_at: meta.started_at,
  });

  if (opts.type === "schedule" && opts.logDir && opts.scheduleId) {
    try {
      const schedLog = join(opts.logDir, `${sanitizeScheduleId(opts.scheduleId)}.log`);
      appendFileSync(
        schedLog,
        `\n=== ${meta.started_at} job ${jobId} started ===\n(also: ${logPath})\n`,
        "utf8",
      );
    } catch {
      /* ignore */
    }
  }

  return { jobId, pid: child.pid };
}

/**
 * @param {object} opts
 * @param {string} opts.metaRoot
 * @param {string} opts.installRoot
 * @param {string} opts.privateRoot
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
  appendFileSync(
    logPath,
    `=== ${meta.started_at} agent-task ${opts.taskId} started ===\n`,
    "utf8",
  );

  const guestScript = join(opts.metaRoot, "bin", "run-agent-task.mjs");
  if (existsSync(guestScript)) {
    const child = spawn(process.execPath, [guestScript, opts.taskId, jobId], {
      cwd: opts.installRoot,
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env,
      windowsHide: true,
      detached: true,
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

  appendFileSync(
    logPath,
    "No bin/run-agent-task.mjs in meta root — mark task approved; agent runners handle execution.\n",
    "utf8",
  );
  completeJob(opts.metaRoot, jobId, { ok: true, exitCode: 0 });
  return { jobId, pid: null };
}

export { MAX_JOB_LOG };
