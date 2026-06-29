/**
 * Guest-side smoke tests for hdc-runner (invoked from maintain).
 */

const GUEST_NODE = "/usr/bin/node";

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 * @param {{ info: (msg: string) => void }} log
 */
export function runGuestDiscordTest(exec, runner, log) {
  const installRoot = runner.install_root;
  const notifyScript = `${installRoot}/tools/hdc/lib/notify-discord.mjs`;
  log.info(`${exec.label}: discord smoke test on guest`);
  const script = [
    "set -e",
    `sudo -u hdc ${GUEST_NODE} '${notifyScript}' --title '[HDC]' --message 'hdc-runner smoke test' --silent`,
  ].join("\n");
  const r = exec.run(script, { capture: true });
  const output = `${r.stdout}${r.stderr}`.trim();
  if (r.status !== 0) {
    return { ok: false, message: output || `exit ${r.status}` };
  }
  return { ok: true, message: output || "discord sent" };
}

/**
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 * @param {string} scheduleId
 * @param {{ info: (msg: string) => void }} log
 */
export function runGuestScheduleTest(exec, runner, scheduleId, log) {
  const meta = runner.meta_root;
  const jobScript = `${meta}/bin/run-scheduled-job.mjs`;
  log.info(`${exec.label}: running schedule ${scheduleId} on guest`);
  const script = `sudo -u hdc ${GUEST_NODE} '${jobScript}' '${scheduleId.replace(/'/g, `'\\''`)}'`;
  const r = exec.run(script, { capture: true });
  const output = `${r.stdout}${r.stderr}`.trim();
  return {
    ok: r.status === 0,
    schedule_id: scheduleId,
    exit_code: r.status,
    message: output || (r.status === 0 ? "ok" : `exit ${r.status}`),
  };
}

/**
 * Dry-run Discord probe (no webhook POST).
 *
 * @param {import("../../postfix-relay/lib/postfix-relay-configure.mjs").ConfigureExec} exec
 * @param {ReturnType<typeof import("./hdc-runner-settings.mjs").normalizeHdcRunnerBlock>} runner
 */
export function probeGuestDiscordDryRun(exec, runner) {
  const notifyScript = `${runner.install_root}/tools/hdc/lib/notify-discord.mjs`;
  const script = `sudo -u hdc ${GUEST_NODE} '${notifyScript}' --message 'probe' --dry-run`;
  const r = exec.run(script, { capture: true });
  const output = `${r.stdout}${r.stderr}`.trim();
  return {
    ok: r.status === 0,
    output: output || null,
  };
}
