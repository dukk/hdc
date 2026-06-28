#!/usr/bin/env node
/**
 * Scheduled job runner — installed on hdc-runner guest at
 * /opt/hdc-runner/bin/run-scheduled-job.mjs
 *
 * Usage: node run-scheduled-job.mjs <schedule-id>
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const META_ROOT = process.env.HDC_RUNNER_META_ROOT || "/opt/hdc-runner";
const INSTALL_ROOT = process.env.HDC_RUNNER_INSTALL_ROOT || "/opt/hdc";
const PRIVATE_ROOT = process.env.HDC_RUNNER_PRIVATE_ROOT || "/opt/hdc-private";

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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

/**
 * @param {string} scheduleId
 */
function loadSchedule(scheduleId) {
  const schedulesPath = join(META_ROOT, "schedules.json");
  const raw = JSON.parse(readFileSync(schedulesPath, "utf8"));
  const list = Array.isArray(raw.schedules) ? raw.schedules : [];
  const sched = list.find((s) => s && s.id === scheduleId);
  if (!sched) throw new Error(`schedule not found: ${scheduleId}`);
  return sched;
}

/**
 * @param {object} opts
 * @param {boolean} opts.ok
 * @param {string} opts.stderr
 * @param {string} opts.stdout
 * @param {string | null} opts.reportPath
 * @returns {string}
 */
function buildDiscordMessage(opts) {
  const MAX = 1200;
  const { ok, stderr, stdout, reportPath } = opts;
  if (reportPath && existsSync(reportPath)) {
    try {
      const md = readFileSync(reportPath, "utf8");
      const excerpt = md.slice(0, MAX);
      return excerpt.length < md.length ? `${excerpt}\n…` : excerpt;
    } catch {
      /* fall through */
    }
  }
  const tail = `${stderr}${stdout}`.trim();
  if (tail) {
    const lines = tail.split(/\r?\n/).slice(-20).join("\n");
    return lines.length > MAX ? lines.slice(-MAX) : lines;
  }
  return ok ? "completed" : "failed (no output captured)";
}

async function main() {
  const scheduleId = process.argv[2]?.trim();
  if (!scheduleId) {
    process.stderr.write("usage: run-scheduled-job.mjs <schedule-id>\n");
    process.exit(2);
  }

  loadDotEnv(join(META_ROOT, ".env"));
  process.env.HDC_PRIVATE_ROOT = PRIVATE_ROOT;

  const schedule = loadSchedule(scheduleId);
  const cli = Array.isArray(schedule.cli) ? schedule.cli.map(String) : [];
  const cliArgs = Array.isArray(schedule.cli_args) ? schedule.cli_args.map(String) : [];
  if (!cli.length) {
    process.stderr.write(`schedule ${scheduleId}: empty cli\n`);
    process.exit(1);
  }

  const cliPath = join(INSTALL_ROOT, "tools/hdc/cli.mjs");
  const args =
    cliArgs.length > 0 ? [cliPath, ...cli, "--", ...cliArgs] : [cliPath, ...cli];

  process.stderr.write(`[hdc-runner] job ${scheduleId}: node ${args.join(" ")}\n`);
  const r = spawnSync(process.execPath, args, {
    cwd: INSTALL_ROOT,
    encoding: "utf8",
    env: process.env,
  });

  const stderr = r.stderr ?? "";
  const stdout = r.stdout ?? "";
  const exitCode = r.status ?? 1;
  const ok = exitCode === 0;

  const logPath = join("/var/log/hdc-runner", `${scheduleId}.log`);
  try {
    appendFileSync(
      logPath,
      `\n--- ${new Date().toISOString()} exit=${exitCode} ---\n${stderr}\n${stdout}\n`,
      "utf8",
    );
  } catch {
    /* ignore */
  }

  const mail = schedule.resolved_mail ?? {};
  const reportEmailUrl = pathToFileURL(
    join(INSTALL_ROOT, "packages/lib/report-email.mjs"),
  ).href;
  const { parseReportPathFromStderr } = await import(reportEmailUrl);
  const reportPath = parseReportPathFromStderr(stderr);

  const shouldMail = mail.enabled === true && (!mail.on_failure_only || !ok);
  if (shouldMail && mail.to) {
    const { sendReportEmail } = await import(reportEmailUrl);
    if (reportPath && existsSync(reportPath)) {
      const prefix = mail.subject_prefix || "[HDC]";
      const subject = `${prefix} ${scheduleId} — ${ok ? "OK" : "FAILED"}`;
      const emailResult = sendReportEmail({
        to: mail.to,
        from: mail.from,
        subject,
        markdownPath: reportPath,
        env: process.env,
      });
      process.stderr.write(
        `[hdc-runner] job ${scheduleId}: email ${emailResult.ok ? "sent" : "failed"}: ${emailResult.message}\n`,
      );
    } else {
      process.stderr.write(`[hdc-runner] job ${scheduleId}: no report file to email\n`);
    }
  }

  const discord = schedule.resolved_discord ?? {};
  const shouldDiscord = discord.enabled === true && (!discord.on_failure_only || !ok);
  if (shouldDiscord) {
    const opsDiscordUrl = pathToFileURL(
      join(INSTALL_ROOT, "tools/hdc/lib/ops-discord-notify.mjs"),
    ).href;
    const { redactIpsFromText, sendOpsDiscordNotifyBestEffort } = await import(opsDiscordUrl);
    const prefix = discord.title_prefix || "[HDC]";
    const title = `${prefix} ${scheduleId} — ${ok ? "OK" : "FAILED"}`;
    const message = buildDiscordMessage({ ok, stderr, stdout, reportPath });
    const discordResult = sendOpsDiscordNotifyBestEffort({
      title,
      message: redactIpsFromText(message),
      env: process.env,
      silent: ok,
    });
    if (discordResult.skipped) {
      process.stderr.write(`[hdc-runner] job ${scheduleId}: discord skipped\n`);
    } else {
      process.stderr.write(
        `[hdc-runner] job ${scheduleId}: discord ${discordResult.ok ? "sent" : "failed"}${discordResult.error ? `: ${discordResult.error}` : ""}\n`,
      );
    }
  }

  process.exit(exitCode);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
