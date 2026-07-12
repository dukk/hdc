#!/usr/bin/env node
/**
 * Ad-hoc hdc CLI job — installed on hdc-runner guest at
 * /opt/hdc-runner/bin/run-adhoc-job.mjs
 *
 * Usage: node run-adhoc-job.mjs <job-id>
 */
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const META_ROOT = process.env.HDC_RUNNER_META_ROOT || "/opt/hdc-runner";
const INSTALL_ROOT = process.env.HDC_RUNNER_INSTALL_ROOT || "/opt/hdc";
const PRIVATE_ROOT = process.env.HDC_RUNNER_PRIVATE_ROOT || "/opt/hdc-private";
const CLI_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * @param {string} path
 */
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

/**
 * @param {string} jobId
 */
function loadJobMeta(jobId) {
  const path = join(META_ROOT, "jobs", `${jobId}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {string} jobId
 * @param {Record<string, unknown>} patch
 */
function updateJobMeta(jobId, patch) {
  const path = join(META_ROOT, "jobs", `${jobId}.json`);
  const current = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}

/**
 * @param {string} jobId
 * @param {string} line
 */
function appendJobLog(jobId, line) {
  appendFileSync(join(META_ROOT, "jobs", `${jobId}.log`), line, "utf8");
}

function clearActiveJob() {
  writeFileSync(join(META_ROOT, "jobs", "active.json"), "{}", "utf8");
}

async function main() {
  const jobId = process.argv[2]?.trim();
  if (!jobId) {
    process.stderr.write("usage: run-adhoc-job.mjs <job-id>\n");
    process.exit(2);
  }

  loadDotEnv(join(META_ROOT, ".env"));
  process.env.HDC_PRIVATE_ROOT = PRIVATE_ROOT;

  const job = loadJobMeta(jobId);
  const tier = String(job.tier ?? "").trim();
  const pkg = String(job.package ?? "").trim();
  const verb = String(job.verb ?? "").trim();
  const args = Array.isArray(job.args) ? job.args.map(String) : [];

  if (!tier || !pkg || !verb) {
    process.stderr.write(`job ${jobId}: missing tier/package/verb\n`);
    updateJobMeta(jobId, { status: "failed", exit_code: 1, finished_at: new Date().toISOString() });
    clearActiveJob();
    process.exit(1);
  }

  const cliPath = join(INSTALL_ROOT, "apps/hdc-cli/cli.mjs");
  const cliArgs =
    args.length > 0
      ? [cliPath, "run", tier, pkg, verb, "--", ...args]
      : [cliPath, "run", tier, pkg, verb];

  process.stderr.write(`[hdc-runner] adhoc ${jobId}: node ${cliArgs.join(" ")}\n`);

  const r = spawnSync(process.execPath, cliArgs, {
    cwd: INSTALL_ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: CLI_MAX_BUFFER,
  });

  const stderr = r.stderr ?? "";
  const stdout = r.stdout ?? "";
  const exitCode = r.status ?? 1;

  appendJobLog(
    jobId,
    `\n--- ${new Date().toISOString()} exit=${exitCode} ---\n${stderr}\n${stdout}\n`,
  );

  updateJobMeta(jobId, {
    status: exitCode === 0 ? "completed" : "failed",
    exit_code: exitCode,
    finished_at: new Date().toISOString(),
  });
  clearActiveJob();
  process.exit(exitCode);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
