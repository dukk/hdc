import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptSlackOperatorPrompt,
  authorizeSlackPromptUser,
  clearSlackEventDedup,
  handleSlackEventsPayload,
  handleSlackSlashCommand,
  parseSlackSlashForm,
  rememberSlackEventId,
  stripSlackBotMention,
} from "./slack-prompt.mjs";

describe("slack-prompt", () => {
  afterEach(() => {
    clearSlackEventDedup();
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

  it("rejects unauthorized app_mention, logs, and posts notice", async () => {
    const fetchFn = vi.fn(async (url, init) => {
      if (String(url).includes("chat.postMessage")) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (String(url).includes("users.info")) {
        return {
          ok: true,
          json: async () => ({ ok: true, user: { name: "other", id: "U9" } }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }), text: async () => "{}" };
    });
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
