#!/usr/bin/env node
/**
 * Scheduled job runner — installed on hdc-runner guest at
 * /opt/hdc-runner/bin/run-scheduled-job.mjs
 *
 * Usage: node run-scheduled-job.mjs <schedule-id> [ui-job-id]
 */
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
 * @param {string} scheduleId
 * @param {string} line
 */
function appendJobLog(scheduleId, line) {
  const logPath = join("/var/log/hdc-runner", `${scheduleId}.log`);
  try {
    appendFileSync(logPath, line, "utf8");
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} jobId
 * @param {string} line
 */
function appendUiJobLog(jobId, line) {
  const logPath = join(META_ROOT, "jobs", `${jobId}.log`);
  try {
    appendFileSync(logPath, line, "utf8");
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} jobId
 * @param {Record<string, unknown>} patch
 */
function updateUiJobMeta(jobId, patch) {
  const path = join(META_ROOT, "jobs", `${jobId}.json`);
  if (!existsSync(path)) return;
  const current = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}

function clearActiveJob() {
  writeFileSync(join(META_ROOT, "jobs", "active.json"), "{}", "utf8");
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

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {boolean} [opts.silent]
 * @param {string} [opts.webhookVaultKey]
 * @returns {Promise<{ ok: boolean; skipped?: boolean; error?: string }>}
 */
async function sendDiscordNotification(opts) {
  const title = String(opts.title ?? "").trim();
  const message = String(opts.message ?? "").trim();
  if (!title && !message) return { ok: false, skipped: true };

  const opsDiscordUrl = pathToFileURL(
    join(INSTALL_ROOT, "tools/hdc/lib/ops-discord-notify.mjs"),
  ).href;
  const vaultAccessUrl = pathToFileURL(
    join(INSTALL_ROOT, "tools/hdc/lib/vault-access.mjs"),
  ).href;
  const nodeCliDepsUrl = pathToFileURL(
    join(INSTALL_ROOT, "tools/hdc/lib/node-cli-deps.mjs"),
  ).href;

  const { formatDiscordContent, postDiscordWebhook, redactIpsFromText } =
    await import(opsDiscordUrl);
  const { createVaultAccess, vaultDepsFromCli } = await import(vaultAccessUrl);
  const { createNodeCliDeps } = await import(nodeCliDepsUrl);

  const deps = createNodeCliDeps();
  const vault = createVaultAccess(vaultDepsFromCli(deps));
  const webhookKey = opts.webhookVaultKey || "HDC_OPS_DISCORD_WEBHOOK_URL";
  let url = String(deps.env[webhookKey] ?? "").trim();
  if (!url) {
    url = String(await vault.getSecret(webhookKey, { optional: true }) ?? "").trim();
  }

  if (!url) {
    return { ok: false, error: `webhook ${webhookKey} not found` };
  }

  const content = formatDiscordContent(title, redactIpsFromText(message), { env: deps.env });
  await postDiscordWebhook(url, content, { suppressNotifications: opts.silent === true });
  return { ok: true };
}

/**
 * @param {object} opts
 */
async function runAgentSchedule(opts) {
  const { scheduleId, schedule, uiJobId } = opts;
  const agentRole = String(schedule.agent_role ?? "hdc-manager").trim();
  const startedAt = opts.startedAt ?? new Date().toISOString();
  const startLine = `\n=== ${startedAt} agent job ${scheduleId} (${agentRole}) started ===\n`;
  appendJobLog(scheduleId, startLine);
  if (uiJobId) appendUiJobLog(uiJobId, startLine);
  process.stderr.write(`[hdc-runner] agent job ${scheduleId}: started (${agentRole})\n`);

  const apiKey = String(process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) {
    process.stderr.write(`[hdc-runner] agent job ${scheduleId}: CURSOR_API_KEY missing\n`);
    process.exit(1);
  }

  const libRoot = join(INSTALL_ROOT, "packages/services/hdc-runner/lib");
  let exitCode = 1;
  let stderr = "";
  let stdout = "";

  if (agentRole === "hdc-manager") {
    const managerScript = join(META_ROOT, "bin/run-agent-manager.mjs");
    const args = [managerScript, scheduleId];
    process.stderr.write(`[hdc-runner] agent job ${scheduleId}: node ${args.join(" ")}\n`);
    const r = spawnSync(process.execPath, args, {
      cwd: INSTALL_ROOT,
      encoding: "utf8",
      env: process.env,
      maxBuffer: CLI_MAX_BUFFER,
    });
    stderr = r.stderr ?? "";
    stdout = r.stdout ?? "";
    exitCode = r.status ?? 1;
  } else {
    const agentRunUrl = pathToFileURL(join(libRoot, "hdc-runner-agent-run.mjs")).href;
    const tasksUrl = pathToFileURL(join(libRoot, "hdc-runner-tasks.mjs")).href;
    const { buildAgentPrompt, runCursorAgent, loadManagerTriageInstructions } = await import(agentRunUrl);
    const { writeTaskReport, listTasks } = await import(tasksUrl);

    const autoPath = join(INSTALL_ROOT, ".cursor", "automations", `${scheduleId.replace(/^agent-/, "")}.md`);
    let instructions = "";
    try {
      if (existsSync(autoPath)) {
        instructions = readFileSync(autoPath, "utf8");
      }
    } catch {
      instructions = loadManagerTriageInstructions(INSTALL_ROOT);
    }

    const prompt = buildAgentPrompt({
      installRoot: INSTALL_ROOT,
      privateRoot: PRIVATE_ROOT,
      role: agentRole,
      instructions,
    });

    const logPath = `/var/log/hdc-runner/agents/${scheduleId}-${Date.now()}.log`;
    const r = runCursorAgent({
      workspace: INSTALL_ROOT,
      apiKey,
      role: agentRole,
      prompt,
      logPath,
    });
    stderr = r.stderr ?? "";
    stdout = r.stdout ?? "";
    exitCode = r.exitCode ?? 1;

    const tasks = listTasks(PRIVATE_ROOT, { includeDone: true });
    writeTaskReport(PRIVATE_ROOT, tasks, { source: scheduleId });
  }

  const ok = exitCode === 0;
  appendJobLog(
    scheduleId,
    `\n--- ${new Date().toISOString()} exit=${exitCode} ---\n${stderr}\n${stdout}\n`,
  );
  if (uiJobId) {
    appendUiJobLog(
      uiJobId,
      `\n--- ${new Date().toISOString()} exit=${exitCode} ---\n${stderr}\n${stdout}\n`,
    );
    updateUiJobMeta(uiJobId, {
      status: ok ? "completed" : "failed",
      exit_code: exitCode,
      finished_at: new Date().toISOString(),
    });
    clearActiveJob();
  }

  const discord = schedule.resolved_discord ?? {};
  const shouldDiscord = discord.enabled === true && (!discord.on_failure_only || !ok);
  if (shouldDiscord) {
    const discordPrefix = discord.title_prefix || "[HDC]";
    const discordWebhookKey =
      typeof discord.webhook_vault_key === "string" && discord.webhook_vault_key.trim()
        ? discord.webhook_vault_key.trim()
        : "HDC_OPS_DISCORD_WEBHOOK_URL";
    const title = `${discordPrefix} ${scheduleId} — ${ok ? "OK" : "FAILED"}`;
    const message = buildDiscordMessage({ ok, stderr, stdout, reportPath: null });
    await sendDiscordNotification({
      title,
      message,
      silent: ok,
      webhookVaultKey: discordWebhookKey,
    });
  }

  process.exit(exitCode);
}

async function main() {
  const scheduleId = process.argv[2]?.trim();
  const uiJobId = process.argv[3]?.trim() || null;
  if (!scheduleId) {
    process.stderr.write("usage: run-scheduled-job.mjs <schedule-id> [ui-job-id]\n");
    process.exit(2);
  }

  loadDotEnv(join(META_ROOT, ".env"));
  process.env.HDC_PRIVATE_ROOT = PRIVATE_ROOT;

  const schedule = loadSchedule(scheduleId);
  const scheduleType = typeof schedule.type === "string" ? schedule.type.trim() : "cli";
  const cli = Array.isArray(schedule.cli) ? schedule.cli.map(String) : [];
  const cliArgs = Array.isArray(schedule.cli_args) ? schedule.cli_args.map(String) : [];

  if (scheduleType === "agent") {
    await runAgentSchedule({
      scheduleId,
      schedule,
      uiJobId,
      startedAt: new Date().toISOString(),
    });
    return;
  }

  if (!cli.length) {
    process.stderr.write(`schedule ${scheduleId}: empty cli\n`);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const startLine = `\n=== ${startedAt} job ${scheduleId} started ===\n`;
  appendJobLog(scheduleId, startLine);
  if (uiJobId) appendUiJobLog(uiJobId, startLine);
  process.stderr.write(`[hdc-runner] job ${scheduleId}: started at ${startedAt}\n`);

  const discord = schedule.resolved_discord ?? {};
  const discordPrefix = discord.title_prefix || "[HDC]";
  const discordWebhookKey =
    typeof discord.webhook_vault_key === "string" && discord.webhook_vault_key.trim()
      ? discord.webhook_vault_key.trim()
      : "HDC_OPS_DISCORD_WEBHOOK_URL";

  if (discord.enabled === true) {
    const startResult = await sendDiscordNotification({
      title: `${discordPrefix} ${scheduleId} — started`,
      message: `Scheduled job started at ${startedAt}`,
      silent: true,
      webhookVaultKey: discordWebhookKey,
    });
    if (startResult.skipped) {
      process.stderr.write(`[hdc-runner] job ${scheduleId}: discord start skipped\n`);
    } else {
      process.stderr.write(
        `[hdc-runner] job ${scheduleId}: discord start ${startResult.ok ? "sent" : "failed"}${startResult.error ? `: ${startResult.error}` : ""}\n`,
      );
    }
  }

  const cliPath = join(INSTALL_ROOT, "tools/hdc/cli.mjs");
  const args =
    cliArgs.length > 0 ? [cliPath, ...cli, "--", ...cliArgs] : [cliPath, ...cli];

  process.stderr.write(`[hdc-runner] job ${scheduleId}: node ${args.join(" ")}\n`);
  const r = spawnSync(process.execPath, args, {
    cwd: INSTALL_ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: CLI_MAX_BUFFER,
  });

  const stderr = r.stderr ?? "";
  const stdout = r.stdout ?? "";
  const exitCode = r.status ?? (r.error ? 1 : 1);
  const ok = exitCode === 0;

  if (r.error) {
    process.stderr.write(
      `[hdc-runner] job ${scheduleId}: cli spawn error: ${r.error.message}\n`,
    );
  }

  appendJobLog(
    scheduleId,
    `\n--- ${new Date().toISOString()} exit=${exitCode} ---\n${stderr}\n${stdout}\n`,
  );
  if (uiJobId) {
    appendUiJobLog(
      uiJobId,
      `\n--- ${new Date().toISOString()} exit=${exitCode} ---\n${stderr}\n${stdout}\n`,
    );
    updateUiJobMeta(uiJobId, {
      status: ok ? "completed" : "failed",
      exit_code: exitCode,
      finished_at: new Date().toISOString(),
    });
    clearActiveJob();
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

  const shouldDiscord = discord.enabled === true && (!discord.on_failure_only || !ok);
  if (shouldDiscord) {
    const title = `${discordPrefix} ${scheduleId} — ${ok ? "OK" : "FAILED"}`;
    const message = buildDiscordMessage({ ok, stderr, stdout, reportPath });
    const discordResult = await sendDiscordNotification({
      title,
      message,
      silent: ok,
      webhookVaultKey: discordWebhookKey,
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
