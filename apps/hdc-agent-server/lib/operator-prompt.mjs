/**
 * Build and run Slack / operator prompts on hdc-manager.
 */
import {
  postSlackChatMessage,
  resolveSlackBotToken,
} from "../../hdc-cli/lib/ops-slack-app-notify.mjs";

const SLACK_REPLY_MAX = 2900;

/**
 * @param {object} opts
 * @param {string} opts.operatorText
 * @param {string} [opts.taskId]
 * @param {string} [opts.source]
 * @param {string} [opts.slackUser]
 * @param {string} [opts.channel]
 * @returns {string}
 */
export function buildOperatorPromptMessage(opts) {
  const text = String(opts.operatorText ?? "").trim();
  const taskId = String(opts.taskId ?? "").trim();
  const source = String(opts.source ?? "slack").trim() || "slack";
  const user = String(opts.slackUser ?? "").trim();
  const channel = String(opts.channel ?? "").trim();
  const lines = [
    "Interactive operator message via Slack.",
    "Answer status questions with hdc tools (uptime-kuma query, digests under operations/reports/, proxmox query as needed).",
    "Create or update operations/tasks/*.md when asked. Escalate needs_decision when required.",
    "End with a concise operator-facing summary suitable for Slack (under ~2000 characters). That summary is posted back to Slack.",
    "",
    `Source: ${source}`,
  ];
  if (user) lines.push(`Slack user: ${user}`);
  if (channel) lines.push(`Slack channel: ${channel}`);
  if (taskId) {
    lines.push(`Audit task: operations/tasks/${taskId}.md`);
    lines.push(`Set that task in_progress then done/blocked when finished.`);
  }
  lines.push("", "Operator message:", text);
  return lines.join("\n");
}

/**
 * @param {string} text
 * @returns {string}
 */
export function truncateSlackReply(text) {
  const s = String(text ?? "").trim();
  if (!s) return "(no reply)";
  if (s.length <= SLACK_REPLY_MAX) return s;
  return `${s.slice(0, SLACK_REPLY_MAX - 3)}...`;
}

/**
 * @param {object} opts
 * @param {string} opts.channel
 * @param {string} [opts.thread_ts]
 * @param {string} opts.text
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {(key: string, opts?: { optional?: boolean }) => Promise<string | null>} [opts.getSecret]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function replyOperatorPromptToSlack(opts) {
  const channel = String(opts.channel ?? "").trim();
  if (!channel) return { ok: false, error: "slack channel required" };
  const env = opts.env ?? process.env;
  const botToken = await resolveSlackBotToken({ env, getSecret: opts.getSecret });
  if (!botToken) return { ok: false, error: "slack bot token not configured" };
  try {
    await postSlackChatMessage({
      botToken,
      channel,
      text: truncateSlackReply(opts.text),
      thread_ts: opts.thread_ts,
      fetchFn: opts.fetchFn,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Enqueue a manager turn and optionally reply to Slack when done.
 *
 * @param {object} opts
 * @param {ReturnType<import("./task-queue.mjs").createTaskQueue>} opts.queue
 * @param {(message: string) => Promise<string>} opts.runTurn
 * @param {string} opts.prompt
 * @param {string} [opts.workId]
 * @param {{ channel: string, thread_ts?: string }} [opts.slackReply]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {(line: string) => void} [opts.log]
 * @returns {{ enqueued: true, work_id: string }}
 */
export function enqueueOperatorPrompt(opts) {
  const log = opts.log ?? (() => {});
  const workId =
    String(opts.workId ?? "").trim() ||
    `operator-prompt-${Date.now().toString(36)}`;
  const slackReply = opts.slackReply;
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn;

  opts.queue.enqueue(workId, opts.prompt, async (msg) => {
    let result = "";
    try {
      result = await opts.runTurn(msg);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      result = `Manager turn failed: ${err}`;
      log(`[operator-prompt] turn failed: ${err}`);
    }
    if (slackReply?.channel) {
      const posted = await replyOperatorPromptToSlack({
        channel: slackReply.channel,
        thread_ts: slackReply.thread_ts,
        text: result,
        env,
        fetchFn,
      });
      if (!posted.ok) {
        log(`[operator-prompt] slack reply failed: ${posted.error}`);
      }
    }
    return result;
  });

  return { enqueued: true, work_id: workId };
}
