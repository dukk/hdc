/**
 * Run one scheduled CLI job (no Cursor agent path).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function syncVaultwardenIfNeeded() {
  if (process.env.HDC_SECRET_BACKEND !== "vaultwarden") return;
  const bw = spawnSync("which", ["bw"], { encoding: "utf8" });
  if (bw.status !== 0) return;
  spawnSync("bw", ["sync"], { encoding: "utf8", env: process.env, timeout: 120_000 });
}

/**
 * @param {object} opts
 */
async function sendDiscord(opts) {
  const installRoot = opts.installRoot;
  const { formatDiscordContent, postDiscordWebhook, redactIpsFromText } = await import(
    pathToFileURL(join(installRoot, "apps/hdc-cli/lib/ops-discord-notify.mjs")).href
  );
  const { createVaultAccess, vaultDepsFromCli } = await import(
    pathToFileURL(join(installRoot, "apps/hdc-cli/lib/vault-access.mjs")).href
  );
  const { createNodeCliDeps } = await import(
    pathToFileURL(join(installRoot, "apps/hdc-cli/lib/node-cli-deps.mjs")).href
  );
  const deps = createNodeCliDeps();
  const vault = createVaultAccess(vaultDepsFromCli(deps));
  const webhookKey = opts.webhookVaultKey || "HDC_AGENTS_DISCORD_WEBHOOK_URL";
  let url = String(deps.env[webhookKey] ?? "").trim();
  if (!url) {
    url = String((await vault.getSecret(webhookKey, { optional: true })) ?? "").trim();
  }
  if (!url) return { ok: false, skipped: true };
  const content = formatDiscordContent(opts.title, redactIpsFromText(opts.message), {
    env: deps.env,
  });
  await postDiscordWebhook(url, content, { suppressNotifications: opts.silent === true });
  return { ok: true };
}

/**
 * Mirror Discord schedule alerts to Slack: prefer HDC app (bot token) when configured,
 * else Incoming Webhook (HDC_AGENTS_SLACK_WEBHOOK_URL).
 *
 * @param {object} opts
 */
async function sendSlack(opts) {
  const installRoot = opts.installRoot;
  const { createVaultAccess, vaultDepsFromCli } = await import(
    pathToFileURL(join(installRoot, "apps/hdc-cli/lib/vault-access.mjs")).href
  );
  const { createNodeCliDeps } = await import(
    pathToFileURL(join(installRoot, "apps/hdc-cli/lib/node-cli-deps.mjs")).href
  );
  const deps = createNodeCliDeps();
  const vault = createVaultAccess(vaultDepsFromCli(deps));
  const getSecret = (key, secretOpts) => vault.getSecret(key, secretOpts);

  const { sendOpsSlackAppMessage } = await import(
    pathToFileURL(join(installRoot, "apps/hdc-cli/lib/ops-slack-app-notify.mjs")).href
  );
  const appResult = await sendOpsSlackAppMessage({
    title: opts.title,
    message: opts.message,
    env: deps.env,
    getSecret,
  });
  if (appResult.ok || (appResult.ok === false && !appResult.skipped)) {
    return appResult;
  }

  const { sendOpsSlackIncomingWebhookMessage } = await import(
    pathToFileURL(join(installRoot, "apps/hdc-cli/lib/ops-slack-incoming-webhook.mjs")).href
  );
  return sendOpsSlackIncomingWebhookMessage({
    title: opts.title,
    message: opts.message,
    env: deps.env,
    getSecret,
    webhookVaultKey: opts.webhookVaultKey || "HDC_AGENTS_SLACK_WEBHOOK_URL",
  });
}

/**
 * @param {object} opts
 */
async function sendDiscordAndSlack(opts) {
  const discord = await sendDiscord(opts);
  const slack = await sendSlack({
    installRoot: opts.installRoot,
    title: opts.title,
    message: opts.message,
  });
  return { discord, slack };
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} opts.schedule
 * @param {string} [opts.installRoot]
 * @param {string} [opts.privateRoot]
 * @param {string} [opts.metaRoot]
 * @param {string} [opts.logDir]
 */
export async function runScheduledCliJob(opts) {
  const schedule = opts.schedule;
  const scheduleId = String(schedule.id);
  const installRoot = opts.installRoot || process.env.HDC_ROOT || "/opt/hdc";
  const privateRoot = opts.privateRoot || process.env.HDC_PRIVATE_ROOT || "/opt/hdc-private";
  const metaRoot = opts.metaRoot || process.env.HDC_AGENTS_META_ROOT || "/opt/hdc-agents-meta";
  const logDir = opts.logDir || join(metaRoot, "logs");
  mkdirSync(logDir, { recursive: true });

  loadDotEnv(join(metaRoot, ".env"));
  process.env.HDC_PRIVATE_ROOT = privateRoot;
  process.env.HDC_ROOT = installRoot;
  syncVaultwardenIfNeeded();

  const cli = Array.isArray(schedule.cli) ? schedule.cli.map(String) : [];
  const cliArgs = Array.isArray(schedule.cli_args) ? schedule.cli_args.map(String) : [];
  if (!cli.length) throw new Error(`schedule ${scheduleId}: empty cli`);

  const startedAt = new Date().toISOString();
  const logPath = join(logDir, `${scheduleId}.log`);
  const startLine = `\n=== ${startedAt} job ${scheduleId} started ===\n`;
  appendFileSync(logPath, startLine, "utf8");
  process.stderr.write(`[hdc-scheduler] job ${scheduleId}: started\n`);

  const cliPath = join(installRoot, "apps/hdc-cli/cli.mjs");
  const opsDailyPath = join(installRoot, "apps/hdc-agent-server/bin/run-daily.mjs");
  const isOpsDaily = cli.length === 1 && cli[0] === "run-daily";

  const discord = /** @type {Record<string, unknown>} */ (schedule.discord ?? {});
  const discordPrefix = String(discord.title_prefix || "[HDC]");
  const discordWebhookKey =
    typeof discord.webhook_vault_key === "string" && discord.webhook_vault_key.trim()
      ? discord.webhook_vault_key.trim()
      : "HDC_AGENTS_DISCORD_WEBHOOK_URL";

  if (discord.enabled === true && !isOpsDaily) {
    await sendDiscordAndSlack({
      installRoot,
      title: `${discordPrefix} ${scheduleId} — started`,
      message: `Scheduled job started at ${startedAt}`,
      silent: true,
      webhookVaultKey: discordWebhookKey,
    });
  }

  const scriptPath = isOpsDaily ? opsDailyPath : cliPath;
  const args = isOpsDaily
    ? [scriptPath, ...cliArgs]
    : cliArgs.length > 0
      ? [cliPath, ...cli, "--", ...cliArgs]
      : [cliPath, ...cli];

  process.stderr.write(`[hdc-scheduler] job ${scheduleId}: node ${args.join(" ")}\n`);
  const childEnv = {
    ...process.env,
    // CLI child notifications are from the hdc CLI surface, not the scheduler role.
    HDC_OPS_NOTIFY_APP: "cli",
  };
  const r = spawnSync(process.execPath, args, {
    cwd: installRoot,
    encoding: "utf8",
    env: childEnv,
    maxBuffer: CLI_MAX_BUFFER,
  });

  const stderr = r.stderr ?? "";
  const stdout = r.stdout ?? "";
  const exitCode = r.status ?? 1;
  const ok = exitCode === 0;

  appendFileSync(
    logPath,
    `\n--- ${new Date().toISOString()} exit=${exitCode} ---\n${stderr}\n${stdout}\n`,
    "utf8",
  );

  const mail = /** @type {Record<string, unknown>} */ (schedule.mail ?? {});
  if (mail.enabled === true && (!mail.on_failure_only || !ok) && mail.to) {
    const { parseReportPathFromStderr, sendReportEmail } = await import(
      pathToFileURL(join(installRoot, "apps/hdc-cli/lib/package/report-email.mjs")).href
    );
    const reportPath = parseReportPathFromStderr(stderr);
    if (reportPath && existsSync(reportPath)) {
      const role = String(process.env.HDC_AGENT_ROLE || "").trim();
      const roleFromEnv = role
        ? String(process.env[`HDC_AGENT_MAIL_FROM_${role.replace(/-/g, "_").toUpperCase()}`] || "").trim()
        : "";
      const from =
        roleFromEnv ||
        (mail.from != null ? String(mail.from) : undefined) ||
        undefined;
      sendReportEmail({
        to: String(mail.to),
        from,
        subject: `${mail.subject_prefix || "[HDC]"} ${scheduleId} — ${ok ? "OK" : "FAILED"}`,
        markdownPath: reportPath,
        env: process.env,
      });
      await sendDiscordAndSlack({
        installRoot,
        title: `${discordPrefix} email sent`,
        message: `To: ${mail.to}\nFrom: ${from || "(relay default)"}\nSubject: ${scheduleId}`,
        silent: true,
        webhookVaultKey: discordWebhookKey,
      });
    }
  }

  const shouldDiscord =
    discord.enabled === true && !isOpsDaily && (!discord.on_failure_only || !ok);
  if (shouldDiscord) {
    await sendDiscordAndSlack({
      installRoot,
      title: `${discordPrefix} ${scheduleId} — ${ok ? "OK" : "FAILED"}`,
      message: `${stderr}${stdout}`.trim().slice(-1200) || (ok ? "completed" : "failed"),
      silent: ok,
      webhookVaultKey: discordWebhookKey,
    });
  }

  return { ok, exitCode, scheduleId };
}
