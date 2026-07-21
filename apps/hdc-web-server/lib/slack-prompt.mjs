/**
 * Slack Events API + slash-command ingress for interactive manager prompts.
 */
import { createHash } from "node:crypto";

import {
  postSlackChatMessage,
  resolveSlackBotToken,
} from "../../hdc-cli/lib/ops-slack-app-notify.mjs";
import { createTask, listTasks } from "../../hdc-agent-server/lib/operations-fs.mjs";
import { triggerOperatorPrompt } from "./manager-dispatch-client.mjs";
import {
  isSlackUserAuthorized,
  resolveSlackDecisionAuthorizedUsers,
} from "./slack-interactions.mjs";

/** @type {Map<string, number>} */
const seenEventIds = new Map();
const EVENT_DEDUP_TTL_MS = 10 * 60 * 1000;
const EVENT_DEDUP_MAX = 500;

/**
 * @param {string} line
 */
function logSlack(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * @param {string} eventId
 * @returns {boolean} true if this id was already seen
 */
export function rememberSlackEventId(eventId) {
  const id = String(eventId ?? "").trim();
  if (!id) return false;
  const now = Date.now();
  for (const [key, ts] of seenEventIds) {
    if (now - ts > EVENT_DEDUP_TTL_MS) seenEventIds.delete(key);
  }
  if (seenEventIds.has(id)) return true;
  seenEventIds.set(id, now);
  while (seenEventIds.size > EVENT_DEDUP_MAX) {
    const oldest = seenEventIds.keys().next().value;
    if (oldest == null) break;
    seenEventIds.delete(oldest);
  }
  return false;
}

/** Clear dedup map (tests). */
export function clearSlackEventDedup() {
  seenEventIds.clear();
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripSlackBotMention(text) {
  return String(text ?? "")
    .replace(/<@[A-Z0-9]+>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} seed
 * @returns {string}
 */
export function slackPromptTaskId(seed) {
  const hash = createHash("sha256").update(String(seed)).digest("hex").slice(0, 10);
  return `slack-${hash}`;
}

/**
 * Best-effort thread/channel reply (unauthorized notices, etc.).
 *
 * @param {object} opts
 * @param {string} opts.channel
 * @param {string} [opts.threadTs]
 * @param {string} opts.text
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function postSlackPromptNotice(opts) {
  const channel = String(opts.channel ?? "").trim();
  if (!channel) return { ok: false, error: "channel required" };
  const env = opts.env ?? process.env;
  const botToken = await resolveSlackBotToken({ env });
  if (!botToken) return { ok: false, error: "slack bot token not configured" };
  try {
    await postSlackChatMessage({
      botToken,
      channel,
      text: String(opts.text ?? "").trim() || "HDC: request ignored.",
      thread_ts: opts.threadTs,
      fetchFn: opts.fetchFn,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {typeof fetch} [fetchFn]
 * @returns {(userId: string) => Promise<string>}
 */
function createUsernameResolver(env = process.env, fetchFn = fetch) {
  /** @type {Map<string, string>} */
  const cache = new Map();
  return async (userId) => {
    const id = String(userId ?? "").trim();
    if (!id) return "";
    if (cache.has(id)) return cache.get(id) ?? "";
    const token = await resolveSlackBotToken({ env });
    if (!token) {
      cache.set(id, "");
      return "";
    }
    try {
      const res = await fetchFn(
        `https://slack.com/api/users.info?user=${encodeURIComponent(id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (data?.ok === false) {
        logSlack(
          `[slack-events] users.info failed user=${id} error=${String(data.error ?? "unknown")}`,
        );
        cache.set(id, "");
        return "";
      }
      const user =
        data?.user && typeof data.user === "object"
          ? /** @type {Record<string, unknown>} */ (data.user)
          : {};
      // Prefer login name (matches allowlist usernames); fall back to real_name.
      const name =
        typeof user.name === "string"
          ? user.name.trim()
          : typeof user.real_name === "string"
            ? user.real_name.trim()
            : "";
      cache.set(id, name);
      return name;
    } catch (e) {
      logSlack(
        `[slack-events] users.info error user=${id}: ${e instanceof Error ? e.message : String(e)}`,
      );
      cache.set(id, "");
      return "";
    }
  };
}

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.username]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(userId: string) => Promise<string>} [opts.resolveUsername]
 * @returns {Promise<{ authorized: boolean, username: string, userId: string }>}
 */
export async function authorizeSlackPromptUser(opts) {
  const env = opts.env ?? process.env;
  const allowlist = resolveSlackDecisionAuthorizedUsers(env);
  const userId = String(opts.userId ?? "").trim();
  let username = String(opts.username ?? "").trim();
  if (!username && userId && opts.resolveUsername) {
    username = await opts.resolveUsername(userId);
  }
  const user = { id: userId, username, name: username };
  return {
    authorized: isSlackUserAuthorized(user, allowlist),
    username,
    userId,
  };
}

/**
 * Create audit task + fire-and-forget manager operator-prompt.
 *
 * @param {object} opts
 * @param {string} opts.privateRoot
 * @param {string} opts.prompt
 * @param {string} opts.channel
 * @param {string} [opts.threadTs]
 * @param {string} [opts.userId]
 * @param {string} [opts.username]
 * @param {string} [opts.source]
 * @param {string} [opts.dedupeKey]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ ok: boolean, task_id?: string, skipped?: boolean, error?: string }>}
 */
export async function acceptSlackOperatorPrompt(opts) {
  const prompt = String(opts.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "empty prompt" };
  const channel = String(opts.channel ?? "").trim();
  if (!channel) return { ok: false, error: "channel required" };

  const privateRoot = String(opts.privateRoot ?? "").trim();
  if (!privateRoot) return { ok: false, error: "private root unset" };

  const dedupeKey = String(opts.dedupeKey ?? `${channel}:${prompt}`).trim();
  const taskId = slackPromptTaskId(dedupeKey);
  const existing = listTasks(privateRoot, { includeDone: true }).find((t) => t.id === taskId);
  if (!existing) {
    const who = opts.username || opts.userId || "unknown";
    createTask(privateRoot, {
      id: taskId,
      role: "hdc-manager",
      priority: "medium",
      status: "pending",
      title: prompt.slice(0, 120),
      evidence: ["slack", opts.source || "slack", channel, who],
      body:
        `From Slack (${opts.source || "slack"})\n` +
        `User: ${who}\n` +
        `Channel: ${channel}\n` +
        (opts.threadTs ? `Thread: ${opts.threadTs}\n` : "") +
        `\n${prompt.slice(0, 4000)}\n`,
    });
  }

  const dispatched = await triggerOperatorPrompt({
    prompt,
    taskId,
    source: opts.source || "slack",
    slackUser: opts.username || opts.userId || "",
    slackReply: {
      channel,
      thread_ts: opts.threadTs || undefined,
    },
    env: opts.env,
    fetchFn: opts.fetchFn,
  });
  if (!dispatched.ok) {
    return {
      ok: false,
      task_id: taskId,
      error: dispatched.message || dispatched.reason || "dispatch failed",
    };
  }
  return { ok: true, task_id: taskId, skipped: Boolean(existing) };
}

/**
 * Handle verified Events API JSON body.
 *
 * @param {object} opts
 * @param {Record<string, unknown>} opts.body
 * @param {string} opts.privateRoot
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ status: number, body: Record<string, unknown> | string }>}
 */
export async function handleSlackEventsPayload(opts) {
  const body = opts.body ?? {};
  const type = String(body.type ?? "");

  if (type === "url_verification") {
    const challenge = typeof body.challenge === "string" ? body.challenge : "";
    return { status: 200, body: { challenge } };
  }

  if (type !== "event_callback") {
    return { status: 200, body: { ok: true } };
  }

  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  if (rememberSlackEventId(eventId)) {
    logSlack(`[slack-events] ignored=deduped event_id=${eventId || "?"}`);
    return { status: 200, body: { ok: true, deduped: true } };
  }

  const event =
    body.event && typeof body.event === "object"
      ? /** @type {Record<string, unknown>} */ (body.event)
      : {};
  const eventType = String(event.type ?? "");
  const channel = typeof event.channel === "string" ? event.channel : "";
  const userId = typeof event.user === "string" ? event.user : "";
  const threadTs =
    typeof event.thread_ts === "string"
      ? event.thread_ts
      : typeof event.ts === "string"
        ? event.ts
        : "";
  const subtype = typeof event.subtype === "string" ? event.subtype : "";
  if (subtype) {
    logSlack(
      `[slack-events] ignored=subtype subtype=${subtype} channel=${channel || "?"} user=${userId || "?"}`,
    );
    return { status: 200, body: { ok: true, ignored: "subtype" } };
  }
  if (event.bot_id || event.bot_profile) {
    logSlack(
      `[slack-events] ignored=bot channel=${channel || "?"} user=${userId || "?"} type=${eventType}`,
    );
    return { status: 200, body: { ok: true, ignored: "bot" } };
  }

  const isMention = eventType === "app_mention";
  const isIm =
    eventType === "message" &&
    (String(event.channel_type ?? "") === "im" || String(event.channel ?? "").startsWith("D"));
  if (!isMention && !isIm) {
    logSlack(
      `[slack-events] ignored=event_type type=${eventType} channel=${channel || "?"} user=${userId || "?"}`,
    );
    return { status: 200, body: { ok: true, ignored: "event_type" } };
  }

  const text = stripSlackBotMention(typeof event.text === "string" ? event.text : "");
  if (!text) {
    logSlack(
      `[slack-events] ignored=empty channel=${channel || "?"} user=${userId || "?"} type=${eventType}`,
    );
    return { status: 200, body: { ok: true, ignored: "empty" } };
  }

  const env = opts.env ?? process.env;
  const auth = await authorizeSlackPromptUser({
    userId,
    env,
    resolveUsername: createUsernameResolver(env, opts.fetchFn),
  });
  if (!auth.authorized) {
    logSlack(
      `[slack-events] ignored=unauthorized channel=${channel || "?"} user=${userId || "?"} username=${auth.username || "(none)"} type=${eventType}`,
    );
    if (channel) {
      void postSlackPromptNotice({
        channel,
        threadTs: threadTs || undefined,
        text: "Not authorized to prompt the HDC manager.",
        env,
        fetchFn: opts.fetchFn,
      }).then((r) => {
        if (!r.ok) {
          logSlack(`[slack-events] unauthorized notice failed: ${r.error}`);
        }
      });
    }
    return { status: 200, body: { ok: true, ignored: "unauthorized" } };
  }

  logSlack(
    `[slack-events] accept type=${isMention ? "mention" : "dm"} channel=${channel} user=${auth.userId} username=${auth.username || "(none)"} event_id=${eventId || "?"}`,
  );

  // Fire and forget — Events API must ack within 3s.
  void acceptSlackOperatorPrompt({
    privateRoot: opts.privateRoot,
    prompt: text,
    channel,
    threadTs,
    userId: auth.userId,
    username: auth.username,
    source: isMention ? "slack-mention" : "slack-dm",
    dedupeKey: eventId || `${channel}:${threadTs}:${text}`,
    env,
    fetchFn: opts.fetchFn,
  })
    .then((result) => {
      if (!result.ok) {
        logSlack(
          `[slack-events] accept ok=false task=${result.task_id || "?"} error=${result.error || "unknown"}`,
        );
      } else {
        logSlack(`[slack-events] accept ok=true task=${result.task_id || "?"}`);
      }
    })
    .catch((e) => {
      logSlack(
        `[slack-events] accept failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });

  return { status: 200, body: { ok: true } };
}

/**
 * Parse application/x-www-form-urlencoded slash command body.
 *
 * @param {string | Buffer} rawBody
 * @returns {Record<string, string>}
 */
export function parseSlackSlashForm(rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
  const params = new URLSearchParams(body);
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out;
}

/**
 * Handle verified slash command form fields.
 *
 * @param {object} opts
 * @param {Record<string, string>} opts.fields
 * @param {string} opts.privateRoot
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function handleSlackSlashCommand(opts) {
  const fields = opts.fields ?? {};
  const command = String(fields.command ?? "").trim();
  if (command && command !== "/hdc") {
    return {
      status: 200,
      body: { response_type: "ephemeral", text: `Unknown command ${command}` },
    };
  }

  const text = String(fields.text ?? "").trim();
  if (!text) {
    return {
      status: 200,
      body: {
        response_type: "ephemeral",
        text: "Usage: `/hdc <prompt>` — e.g. `/hdc what's down?` or `/hdc create a task to check mailcow`.",
      },
    };
  }

  const userId = String(fields.user_id ?? "").trim();
  const username = String(fields.user_name ?? "").trim();
  const env = opts.env ?? process.env;
  const auth = await authorizeSlackPromptUser({
    userId,
    username,
    env,
  });
  if (!auth.authorized) {
    logSlack(
      `[slack-commands] ignored=unauthorized user=${userId || "?"} username=${username || "(none)"}`,
    );
    return {
      status: 200,
      body: {
        response_type: "ephemeral",
        text: "Not authorized to prompt the HDC manager.",
      },
    };
  }

  const channel = String(fields.channel_id ?? "").trim();
  const triggerId = String(fields.trigger_id ?? fields.command_id ?? `${userId}:${text}`).trim();

  logSlack(
    `[slack-commands] accept channel=${channel || "?"} user=${auth.userId} username=${auth.username || username || "(none)"}`,
  );

  void acceptSlackOperatorPrompt({
    privateRoot: opts.privateRoot,
    prompt: text,
    channel,
    threadTs: undefined,
    userId: auth.userId,
    username: auth.username || username,
    source: "slack-slash",
    dedupeKey: triggerId,
    env,
    fetchFn: opts.fetchFn,
  })
    .then((result) => {
      if (!result.ok) {
        logSlack(
          `[slack-commands] accept ok=false task=${result.task_id || "?"} error=${result.error || "unknown"}`,
        );
      } else {
        logSlack(`[slack-commands] accept ok=true task=${result.task_id || "?"}`);
      }
    })
    .catch((e) => {
      logSlack(
        `[slack-commands] accept failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });

  return {
    status: 200,
    body: {
      response_type: "ephemeral",
      text: "Working on it — I'll reply in this channel shortly.",
    },
  };
}
