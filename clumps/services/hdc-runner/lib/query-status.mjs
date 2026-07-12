import { listHdcRunnerDeploymentSummaries } from "./deployments.mjs";
import { cronFilePath, sanitizeScheduleId } from "./hdc-runner-render-cron.mjs";
import { probeGuestDiscordDryRun } from "./hdc-runner-guest-test.mjs";
import { buildScheduleStatusScript } from "./hdc-runner-log-parse.mjs";

export { buildScheduleStatusScript };

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 * @param {{ discordProbe?: boolean }} [opts]
 */
export async function queryHdcRunnerLive(exec, runner, opts = {}) {
  /** @type {Record<string, unknown>} */
  const out = {
    install_root: runner.install_root,
    private_root: runner.private_root,
    meta_root: runner.meta_root,
    schedule_count: runner.schedules.length,
    cron_tz: runner.cron_tz,
  };

  const checks = [
    ["node --version", "node_version"],
    ["bw --version 2>/dev/null | head -1", "bw_version"],
    ["test -f /opt/hdc-runner/.env && echo yes || echo no", "env_file"],
    ["test -f /opt/hdc-runner/schedules.json && echo yes || echo no", "schedules_file"],
    ["ls -1 /etc/cron.d/hdc-runner-* 2>/dev/null || true", "cron_files"],
    ["systemctl is-active cron 2>/dev/null || true", "cron_service"],
    ["du -sh /opt/hdc /opt/hdc-private 2>/dev/null || true", "disk_usage"],
    ["tail -n 5 /var/log/hdc-runner/*.log 2>/dev/null || true", "recent_logs"],
    ["systemctl is-active postfix 2>/dev/null || true", "postfix"],
    ["systemctl is-active hdc-runner-ui 2>/dev/null || true", "ui_service"],
  ];

  for (const [cmd, key] of checks) {
    const r = exec.run(cmd, { capture: true });
    out[key] = `${r.stdout}${r.stderr}`.trim() || null;
  }

  const statusScript = buildScheduleStatusScript(runner.meta_root);
  const statusRun = exec.run(statusScript, { capture: true });
  const statusText = `${statusRun.stdout}`.trim();
  /** @type {unknown} */
  let schedules = [];
  try {
    schedules = JSON.parse(statusText || "[]");
  } catch {
    schedules = runner.schedules.map((s) => ({
      id: sanitizeScheduleId(String(s.id ?? "")),
      cron_file: cronFilePath(String(s.id ?? "")),
      log_path: `/var/log/hdc-runner/${sanitizeScheduleId(String(s.id ?? ""))}.log`,
      parse_error: statusText || null,
    }));
  }
  out.schedules = schedules;

  if (opts.discordProbe !== false) {
    out.discord_probe = probeGuestDiscordDryRun(exec, runner);
  }

  if (runner.web?.enabled !== false) {
    const port = runner.web?.port ?? 9120;
    const healthCmd = `curl -sf -m 3 http://127.0.0.1:${port}/api/health 2>/dev/null || echo fail`;
    const healthRun = exec.run(healthCmd, { capture: true });
    out.ui_health = `${healthRun.stdout}${healthRun.stderr}`.trim() || null;
    out.ui_port = port;
  }

  return out;
}

export { listHdcRunnerDeploymentSummaries };
