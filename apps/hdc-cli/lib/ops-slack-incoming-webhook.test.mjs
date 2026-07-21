import { describe, expect, it, vi } from "vitest";

import {
  AGENTS_SLACK_WEBHOOK_KEY,
  formatSlackIncomingWebhookText,
  OPS_SLACK_WEBHOOK_KEY,
  postSlackWebhook,
  resolveOpsSlackWebhookUrl,
  sendOpsSlackIncomingWebhookMessage,
} from "./ops-slack-incoming-webhook.mjs";

describe("ops-slack-incoming-webhook", () => {
  describe("formatSlackIncomingWebhookText", () => {
    it("strips Discord bold markers from attribution header", () => {
      const text = formatSlackIncomingWebhookText("Job OK", "done", {
        system: "hdc-agents-a",
        app: "cli",
      });
      expect(text).toContain("Job OK");
      expect(text).toContain("`hdc-agents-a`");
      expect(text).toContain("`cli`");
      expect(text).not.toContain("**");
      expect(text).toContain("done");
    });
  });

  describe("resolveOpsSlackWebhookUrl", () => {
    it("prefers OPS over AGENTS env", async () => {
      const url = await resolveOpsSlackWebhookUrl({
        env: {
          [OPS_SLACK_WEBHOOK_KEY]: "https://hooks.slack.example.invalid/ops",
          [AGENTS_SLACK_WEBHOOK_KEY]: "https://hooks.slack.example.invalid/agents",
        },
      });
      expect(url).toBe("https://hooks.slack.example.invalid/ops");
    });

    it("falls back to AGENTS when OPS unset", async () => {
      const url = await resolveOpsSlackWebhookUrl({
        env: {
          [AGENTS_SLACK_WEBHOOK_KEY]: "https://hooks.slack.example.invalid/agents",
        },
      });
      expect(url).toBe("https://hooks.slack.example.invalid/agents");
    });

    it("reads vault when env empty", async () => {
      const getSecret = vi.fn(async (key) =>
        key === AGENTS_SLACK_WEBHOOK_KEY ? "https://hooks.slack.example.invalid/vault" : null,
      );
      const url = await resolveOpsSlackWebhookUrl({
        env: {},
        getSecret,
      });
      expect(url).toBe("https://hooks.slack.example.invalid/vault");
      expect(getSecret).toHaveBeenCalled();
    });

    it("returns null when nothing configured", async () => {
      const url = await resolveOpsSlackWebhookUrl({ env: {}, getSecret: async () => null });
      expect(url).toBeNull();
    });
  });

  describe("postSlackWebhook / sendOpsSlackIncomingWebhookMessage", () => {
    it("posts JSON text payload", async () => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        text: async () => "ok",
      }));
      await postSlackWebhook("https://hooks.slack.example.invalid/abc", "hello", { fetchFn });
      expect(fetchFn).toHaveBeenCalledWith(
        "https://hooks.slack.example.invalid/abc",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ text: "hello" }),
        }),
      );
    });

    it("skips when webhook missing", async () => {
      const result = await sendOpsSlackIncomingWebhookMessage({
        title: "T",
        message: "M",
        env: {},
        getSecret: async () => null,
      });
      expect(result.ok).toBe(false);
      expect(result.skipped).toBe(true);
    });

    it("sends when AGENTS webhook present", async () => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        text: async () => "ok",
      }));
      const result = await sendOpsSlackIncomingWebhookMessage({
        title: "Job OK",
        message: "completed",
        env: {
          [AGENTS_SLACK_WEBHOOK_KEY]: "https://hooks.slack.example.invalid/agents",
          HDC_OPS_SYSTEM_ID: "hdc-agents-a",
          HDC_OPS_NOTIFY_APP: "cli",
        },
        fetchFn,
      });
      expect(result).toEqual({ ok: true, mode: "slack-incoming-webhook" });
      expect(fetchFn).toHaveBeenCalled();
      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.text).toContain("Job OK");
      expect(body.text).toContain("completed");
    });
  });
});
