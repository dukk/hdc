/**
 * Trigger immediate approved-task dispatch via hdc-manager internal API.
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function managerInternalBase(env = process.env) {
  return (
    String(env.HDC_MANAGER_A2A_URL ?? env.HDC_MANAGER_INTERNAL_URL ?? "http://hdc-manager:9200").trim() ||
    "http://hdc-manager:9200"
  ).replace(/\/$/, "");
}

/**
 * @param {string} taskId
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function triggerApprovedTaskDispatch(taskId, env = process.env) {
  const token = String(env.HDC_WEB_API_TOKEN ?? "").trim();
  if (!token) {
    return { ok: false, skipped: true, reason: "HDC_WEB_API_TOKEN unset" };
  }
  const url = `${managerInternalBase(env)}/internal/dispatch-task`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ task_id: taskId }),
    });
    const text = await res.text();
    /** @type {Record<string, unknown>} */
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: typeof body.error === "string" ? body.error : text.slice(0, 300),
      };
    }
    return { ok: true, ...body };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Ask hdc-manager to scan needs_decision tasks and send notifications.
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function triggerManagerDecisionScan(env = process.env) {
  const token = String(env.HDC_WEB_API_TOKEN ?? "").trim();
  if (!token) {
    return { ok: false, skipped: true, reason: "HDC_WEB_API_TOKEN unset" };
  }
  const url = `${managerInternalBase(env)}/internal/scan-decisions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    /** @type {Record<string, unknown>} */
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { ok: res.ok, status: res.status, ...body };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Enqueue an interactive operator prompt on hdc-manager (Slack chat).
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.taskId]
 * @param {string} [opts.source]
 * @param {string} [opts.slackUser]
 * @param {{ channel: string, thread_ts?: string }} [opts.slackReply]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchFn]
 */
export async function triggerOperatorPrompt(opts) {
  const env = opts.env ?? process.env;
  const token = String(env.HDC_WEB_API_TOKEN ?? "").trim();
  if (!token) {
    return { ok: false, skipped: true, reason: "HDC_WEB_API_TOKEN unset" };
  }
  const prompt = String(opts.prompt ?? "").trim();
  if (!prompt) {
    return { ok: false, message: "prompt required" };
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const url = `${managerInternalBase(env)}/internal/operator-prompt`;
  /** @type {Record<string, unknown>} */
  const body = {
    prompt,
    source: opts.source ?? "slack",
  };
  if (opts.taskId) body.task_id = opts.taskId;
  if (opts.slackUser) body.slack_user = opts.slackUser;
  if (opts.slackReply?.channel) {
    body.slack_reply = {
      channel: opts.slackReply.channel,
      ...(opts.slackReply.thread_ts ? { thread_ts: opts.slackReply.thread_ts } : {}),
    };
  }
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    /** @type {Record<string, unknown>} */
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: typeof parsed.error === "string" ? parsed.error : text.slice(0, 300),
      };
    }
    return { ok: true, ...parsed };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
