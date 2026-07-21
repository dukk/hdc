import { describe, expect, it, vi } from "vitest";

import {
  SLACK_BOT_TOKEN_KEY,
  SLACK_DECISION_CHANNEL_ENV,
  buildSlackDecisionBlocks,
  formatSlackAppText,
  isSlackChannelId,
  normalizeSlackChannelRef,
  parseSlackDecisionActionId,
  postSlackChatMessage,
  resolveSlackChannelForPost,
  resolveSlackChannelNameToId,
  sendOpsSlackAppMessage,
} from "./ops-slack-app-notify.mjs";

describe("ops-slack-app-notify", () => {
  describe("normalizeSlackChannelRef / isSlackChannelId", () => {
    it("strips leading hash and detects ids", () => {
      expect(normalizeSlackChannelRef("#hdc")).toBe("hdc");
      expect(normalizeSlackChannelRef("  C123  ")).toBe("C123");
      expect(isSlackChannelId("C123ABC")).toBe(true);
      expect(isSlackChannelId("hdc")).toBe(false);
    });
  });

  describe("resolveSlackChannelNameToId / resolveSlackChannelForPost", () => {
    it("returns id when conversations.list matches name", async () => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [{ id: "C999", name: "hdc" }],
          response_metadata: {},
        }),
      }));
      await expect(
        resolveSlackChannelNameToId({
          botToken: "xoxb-test",
          name: "#hdc",
          fetchFn,
        }),
      ).resolves.toBe("C999");
    });

    it("passes through channel ids without listing", async () => {
      const fetchFn = vi.fn();
      await expect(
        resolveSlackChannelForPost({
          channel: "C123",
          botToken: "xoxb-test",
          fetchFn,
        }),
      ).resolves.toBe("C123");
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("resolves #name via list before post", async () => {
      const fetchFn = vi.fn(async (url) => {
        if (String(url).includes("conversations.list")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              channels: [{ id: "C999", name: "hdc" }],
            }),
          };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      });
      const result = await sendOpsSlackAppMessage({
        title: "T",
        message: "M",
        env: {
          [SLACK_BOT_TOKEN_KEY]: "xoxb-test",
          [SLACK_DECISION_CHANNEL_ENV]: "#hdc",
        },
        fetchFn,
      });
      expect(result).toEqual({ ok: true, mode: "slack-hdc-app" });
      const postCall = fetchFn.mock.calls.find((c) =>
        String(c[0]).includes("chat.postMessage"),
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall[1].body);
      expect(body.channel).toBe("C999");
    });
  });

  describe("formatSlackAppText", () => {
    it("formats attribution without Discord bold", () => {
      const text = formatSlackAppText("Job OK", "done", {
        system: "hdc-agents-a",
        app: "cli",
      });
      expect(text).toContain("Job OK");
      expect(text).not.toContain("**");
      expect(text).toContain("done");
    });
  });

  describe("buildSlackDecisionBlocks / parseSlackDecisionActionId", () => {
    it("builds approve and deny buttons", () => {
      const blocks = buildSlackDecisionBlocks("task-a");
      expect(blocks).toHaveLength(1);
      const elements = /** @type {{ elements: { action_id: string }[] }} */ (blocks[0]).elements;
      expect(elements[0].action_id).toBe("hdc:approve:task-a");
      expect(elements[1].action_id).toBe("hdc:deny:task-a");
    });

    it("parses action ids", () => {
      expect(parseSlackDecisionActionId("hdc:approve:task-a")).toEqual({
        action: "approve",
        taskId: "task-a",
      });
      expect(parseSlackDecisionActionId("hdc:deny:task-b")).toEqual({
        action: "deny",
        taskId: "task-b",
      });
      expect(parseSlackDecisionActionId("other")).toBeNull();
    });
  });

  describe("postSlackChatMessage / sendOpsSlackAppMessage", () => {
    it("posts chat.postMessage JSON", async () => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, ts: "1.2" }),
      }));
      await postSlackChatMessage({
        botToken: "xoxb-test",
        channel: "C123",
        text: "hello",
        fetchFn,
      });
      expect(fetchFn).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer xoxb-test",
          }),
        }),
      );
    });

    it("includes thread_ts when set", async () => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true }),
      }));
      await postSlackChatMessage({
        botToken: "xoxb-test",
        channel: "C123",
        text: "hello",
        thread_ts: "1.234",
        fetchFn,
      });
      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.thread_ts).toBe("1.234");
    });

    it("skips when bot token missing", async () => {
      const result = await sendOpsSlackAppMessage({
        title: "T",
        message: "M",
        env: {},
        getSecret: async () => null,
      });
      expect(result.ok).toBe(false);
      expect(result.skipped).toBe(true);
    });

    it("sends decision message with blocks", async () => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true }),
      }));
      const result = await sendOpsSlackAppMessage({
        title: "Needs decision",
        message: "Please review",
        decision: true,
        taskId: "task-a",
        env: {
          [SLACK_BOT_TOKEN_KEY]: "xoxb-test",
          [SLACK_DECISION_CHANNEL_ENV]: "C123",
        },
        fetchFn,
      });
      expect(result).toEqual({ ok: true, mode: "slack-hdc-app" });
      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.channel).toBe("C123");
      expect(body.blocks.some((b) => b.type === "actions")).toBe(true);
      expect(body.text).toContain("task-a");
    });
  });
});
