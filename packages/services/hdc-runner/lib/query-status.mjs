import { listHdcRunnerDeploymentSummaries } from "./deployments.mjs";

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 */
export async function queryHdcRunnerLive(exec, runner) {
  /** @type {Record<string, unknown>} */
  const out = {
    install_root: runner.install_root,
    private_root: runner.private_root,
    meta_root: runner.meta_root,
    schedule_count: runner.schedules.length,
  };

  const checks = [
    ["node --version", "node_version"],
    ["bw --version 2>/dev/null | head -1", "bw_version"],
    ["test -f /opt/hdc-runner/.env && echo yes || echo no", "env_file"],
    ["test -f /opt/hdc-runner/schedules.json && echo yes || echo no", "schedules_file"],
    ["ls -1 /etc/cron.d/hdc-runner-* 2>/dev/null || true", "cron_files"],
    ["du -sh /opt/hdc /opt/hdc-private 2>/dev/null || true", "disk_usage"],
    ["tail -n 5 /var/log/hdc-runner/*.log 2>/dev/null || true", "recent_logs"],
    ["systemctl is-active postfix 2>/dev/null || true", "postfix"],
  ];

  for (const [cmd, key] of checks) {
    const r = exec.run(cmd, { capture: true });
    out[key] = `${r.stdout}${r.stderr}`.trim() || null;
  }

  return out;
}

export { listHdcRunnerDeploymentSummaries };
