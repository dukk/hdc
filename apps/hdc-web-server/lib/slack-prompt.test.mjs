import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptSlackOperatorPrompt,
  authorizeSlackPromptUser,
  clearSlackEventDedup,
  clearSlackIdentityCache,
  handleSlackEventsPayload,
  handleSlackSlashCommand,
  parseSlackSlashForm,
  rememberSlackEventId,
  stripSlackBotMention,
} from "./slack-prompt.mjs";

/**
 * @param {string} url
 * @param {Record<string, unknown>} [auth]
 * @param {Record<string, unknown>} [users]
 */
function mockSlackFetch(auth = { user_id: "UBOT", bot_id: "BBOT" }, users = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("auth.test")) {
      return { ok: true, json: async () => ({ ok: true, ...auth }) };
    }
    if (u.includes("users.info")) {
      const id = new URL(u).searchParams.get("user") ?? "";
      const user = users[id] ?? { name: "other", id };
      return { ok: true, json: async () => ({ ok: true, user }) };
    }
    if (u.includes("chat.postMessage")) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ ok: true }), text: async () => "{}" };
  });
}

describe("slack-prompt", () => {
  afterEach(() => {
    clearSlackEventDedup();
    clearSlackIdentityCache();
  });

  it("strips bot mentions", () => {
    expect(stripSlackBotMention("<@U0BOT> what's down?")).toBe("what's down?");
  });

  it("dedupes event ids", () => {
    expect(rememberSlackEventId("Ev1")).toBe(false);
    expect(rememberSlackEventId("Ev1")).toBe(true);
  });

  it("parses slash form body", () => {
    const fields = parseSlackSlashForm(
      "command=%2Fhdc&text=hello+world&user_id=U1&user_name=dukk&channel_id=C1",
    );
    expect(fields.command).toBe("/hdc");
    expect(fields.text).toBe("hello world");
    expect(fields.user_name).toBe("dukk");
  });

  it("authorizes by username allowlist", async () => {
    const ok = await authorizeSlackPromptUser({
      userId: "U1",
      username: "dukk",
      env: { HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk" },
    });
    expect(ok.authorized).toBe(true);
    const no = await authorizeSlackPromptUser({
      userId: "U1",
      username: "other",
      env: { HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk" },
    });
    expect(no.authorized).toBe(false);
  });

  it("handles url_verification challenge", async () => {
    const result = await handleSlackEventsPayload({
      body: { type: "url_verification", challenge: "abc123" },
      privateRoot: "/tmp",
    });
    expect(result).toEqual({ status: 200, body: { challenge: "abc123" } });
  });

  it("ignores bot messages", async () => {
    const result = await handleSlackEventsPayload({
      body: {
        type: "event_callback",
        event_id: "EvBot",
        event: {
          type: "message",
          channel_type: "im",
          bot_id: "B1",
          text: "hi",
          channel: "D1",
        },
      },
      privateRoot: "/tmp",
    });
    expect(result.body).toMatchObject({ ignored: "bot" });
  });

  it("ignores app_mention from self (auth.test user_id)", async () => {
    const fetchFn = mockSlackFetch({ user_id: "USELF", bot_id: "BSELF" });
    const result = await handleSlackEventsPayload({
      body: {
        type: "event_callback",
        event_id: "EvSelfMention",
        event: {
          type: "app_mention",
          user: "USELF",
          text: "<@UBOT> Needs decision: reboot hypervisor-a",
          channel: "C1",
          ts: "1.0",
        },
      },
      privateRoot: "/tmp",
      env: { HDC_SLACK_BOT_TOKEN: "xoxb-test" },
      fetchFn,
    });
    expect(result.body).toMatchObject({ ignored: "self" });
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes("chat.postMessage"))).toBe(
      false,
    );
  });

  it("ignores message.im from self", async () => {
    const fetchFn = mockSlackFetch({ user_id: "USELF", bot_id: "BSELF" });
    const result = await handleSlackEventsPayload({
      body: {
        type: "event_callback",
        event_id: "EvSelfIm",
        event: {
          type: "message",
          channel_type: "im",
          user: "USELF",
          text: "status summary",
          channel: "D1",
          ts: "2.0",
        },
      },
      privateRoot: "/tmp",
      env: { HDC_SLACK_BOT_TOKEN: "xoxb-test" },
      fetchFn,
    });
    expect(result.body).toMatchObject({ ignored: "self" });
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes("chat.postMessage"))).toBe(
      false,
    );
  });

  it("still accepts normal user app_mention when auth.test is a different id", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-slack-prompt-"));
    mkdirSync(join(root, "operations", "tasks"), { recursive: true });
    const fetchFn = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("auth.test")) {
        return {
          ok: true,
          json: async () => ({ ok: true, user_id: "UBOT", bot_id: "BBOT" }),
        };
      }
      if (u.includes("users.info")) {
        return {
          ok: true,
          json: async () => ({ ok: true, user: { name: "dukk", id: "U1" } }),
        };
      }
      if (u.includes("operator-prompt") || u.includes("manager")) {
        return {
          ok: true,
          status: 202,
          text: async () => JSON.stringify({ ok: true, enqueued: true }),
        };
      }
      return { ok: true, status: 202, text: async () => "{}", json: async () => ({ ok: true }) };
    });
    try {
      const result = await handleSlackEventsPayload({
        body: {
          type: "event_callback",
          event_id: "EvUserMention",
          event: {
            type: "app_mention",
            user: "U1",
            text: "<@UBOT> what's down?",
            channel: "C1",
            ts: "3.0",
          },
        },
        privateRoot: root,
        env: {
          HDC_SLACK_BOT_TOKEN: "xoxb-test",
          HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk",
          HDC_WEB_API_TOKEN: "tok",
          HDC_MANAGER_INTERNAL_URL: "http://manager.test",
        },
        fetchFn,
      });
      expect(result.body).toEqual({ ok: true });
      expect(result.body).not.toHaveProperty("ignored");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fail-open: processes user events when auth.test fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-slack-prompt-"));
    mkdirSync(join(root, "operations", "tasks"), { recursive: true });
    const fetchFn = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("auth.test")) {
        return { ok: true, json: async () => ({ ok: false, error: "invalid_auth" }) };
      }
      if (u.includes("users.info")) {
        return {
          ok: true,
          json: async () => ({ ok: true, user: { name: "dukk", id: "U1" } }),
        };
      }
      return { ok: true, status: 202, text: async () => "{}", json: async () => ({ ok: true }) };
    });
    try {
      const result = await handleSlackEventsPayload({
        body: {
          type: "event_callback",
          event_id: "EvFailOpen",
          event: {
            type: "app_mention",
            user: "U1",
            text: "<@UBOT> status",
            channel: "C1",
            ts: "4.0",
          },
        },
        privateRoot: root,
        env: {
          HDC_SLACK_BOT_TOKEN: "xoxb-test",
          HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk",
          HDC_WEB_API_TOKEN: "tok",
          HDC_MANAGER_INTERNAL_URL: "http://manager.test",
        },
        fetchFn,
      });
      expect(result.body).toEqual({ ok: true });
      expect(result.body).not.toHaveProperty("ignored");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unauthorized app_mention, logs, and posts notice", async () => {
    const fetchFn = mockSlackFetch(
      { user_id: "UBOT", bot_id: "BBOT" },
      { U9: { name: "other", id: "U9" } },
    );
    const result = await handleSlackEventsPayload({
      body: {
        type: "event_callback",
        event_id: "EvUnauth",
        event: {
          type: "app_mention",
          user: "U9",
          text: "<@UBOT> status",
          channel: "C1",
          ts: "1.0",
        },
      },
      privateRoot: "/tmp",
      env: {
        HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk",
        HDC_SLACK_BOT_TOKEN: "xoxb-test",
      },
      fetchFn,
    });
    expect(result.body).toMatchObject({ ignored: "unauthorized" });
    // users.info + unauthorized notice postMessage
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes("chat.postMessage"))).toBe(true);
  });

  it("slash empty text returns usage help", async () => {
    const result = await handleSlackSlashCommand({
      fields: { command: "/hdc", text: "", user_id: "U1", user_name: "dukk", channel_id: "C1" },
      privateRoot: "/tmp",
      env: { HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk" },
    });
    expect(result.body.text).toMatch(/Usage/i);
  });

  it("slash unauthorized returns ephemeral deny", async () => {
    const result = await handleSlackSlashCommand({
      fields: {
        command: "/hdc",
        text: "hello",
        user_id: "U1",
        user_name: "other",
        channel_id: "C1",
      },
      privateRoot: "/tmp",
      env: { HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk" },
    });
    expect(result.body.text).toMatch(/Not authorized/i);
  });

  it("acceptSlackOperatorPrompt creates task and dispatches", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-slack-prompt-"));
    mkdirSync(join(root, "operations", "tasks"), { recursive: true });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({ ok: true, enqueued: true }),
    }));
    try {
      const result = await acceptSlackOperatorPrompt({
        privateRoot: root,
        prompt: "what's down?",
        channel: "C123",
        threadTs: "1.2",
        userId: "U1",
        username: "dukk",
        source: "slack-slash",
        dedupeKey: "test-1",
        env: { HDC_WEB_API_TOKEN: "tok", HDC_MANAGER_INTERNAL_URL: "http://manager.test" },
        fetchFn,
      });
      expect(result.ok).toBe(true);
      expect(result.task_id).toMatch(/^slack-/);
      expect(fetchFn).toHaveBeenCalledWith(
        "http://manager.test/internal/operator-prompt",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer tok" }),
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
