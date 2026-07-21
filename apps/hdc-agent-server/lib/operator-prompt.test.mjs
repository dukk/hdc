import { describe, expect, it, vi } from "vitest";

import { createTaskQueue } from "./task-queue.mjs";
import {
  buildOperatorPromptMessage,
  enqueueOperatorPrompt,
  replyOperatorPromptToSlack,
  truncateSlackReply,
} from "./operator-prompt.mjs";

describe("operator-prompt", () => {
  it("builds Slack-aware prompt framing", () => {
    const prompt = buildOperatorPromptMessage({
      operatorText: "what's down?",
      taskId: "slack-abc",
      source: "slack-slash",
      slackUser: "dukk",
      channel: "C1",
    });
    expect(prompt).toContain("Interactive operator message via Slack");
    expect(prompt).toContain("what's down?");
    expect(prompt).toContain("slack-abc");
    expect(prompt).toContain("dukk");
  });

  it("truncates long replies", () => {
    const long = "x".repeat(4000);
    expect(truncateSlackReply(long).length).toBeLessThanOrEqual(2900);
  });

  it("replyOperatorPromptToSlack posts thread_ts", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    const result = await replyOperatorPromptToSlack({
      channel: "C123",
      thread_ts: "9.9",
      text: "All green.",
      env: { HDC_SLACK_BOT_TOKEN: "xoxb-test" },
      fetchFn,
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.thread_ts).toBe("9.9");
    expect(body.channel).toBe("C123");
    expect(body.text).toBe("All green.");
  });

  it("enqueues turn and posts Slack reply", async () => {
    const queue = createTaskQueue();
    const runTurn = vi.fn(async () => "All green.");
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    enqueueOperatorPrompt({
      queue,
      runTurn,
      prompt: "test prompt",
      workId: "op-1",
      slackReply: { channel: "C123", thread_ts: "9.9" },
      env: { HDC_SLACK_BOT_TOKEN: "xoxb-test" },
      fetchFn,
      log: () => {},
    });

    for (let i = 0; i < 40; i++) {
      const task = queue.get("op-1");
      if (task?.status === "completed" || task?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(runTurn).toHaveBeenCalledWith("test prompt");
    expect(queue.get("op-1")?.status).toBe("completed");
    expect(fetchFn).toHaveBeenCalled();
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.thread_ts).toBe("9.9");
    expect(body.text).toBe("All green.");
  });
});
