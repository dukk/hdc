import { createHmac } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSlackReplaceOriginalAck,
  buildSlackUpdatedDecisionText,
  parseSlackInteractionPayload,
  verifySlackInteractionSignature,
  handleSlackInteractionPayload,
  isSlackUserAuthorized,
  resolveSlackDecisionAuthorizedUsers,
  slackMrkdwnFromDecisionMessage,
} from "./slack-interactions.mjs";

describe("slack-interactions", () => {
  /** @type {string[]} */
  const temps = [];

  afterEach(() => {
    for (const t of temps) {
      try {
        rmSync(t, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    temps.length = 0;
  });

  it("verifies Slack signing secret HMAC", () => {
    const secret = "test-signing-secret";
    const timestamp = "1710000000";
    const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";
    const base = `v0:${timestamp}:${body}`;
    const digest = createHmac("sha256", secret).update(base, "utf8").digest("hex");
    const signature = `v0=${digest}`;
    expect(
      verifySlackInteractionSignature({
        signingSecret: secret,
        signatureHeader: signature,
        timestampHeader: timestamp,
        rawBody: body,
        nowSec: 1710000000,
      }),
    ).toBe(true);
    expect(
      verifySlackInteractionSignature({
        signingSecret: secret,
        signatureHeader: "v0=deadbeef",
        timestampHeader: timestamp,
        rawBody: body,
        nowSec: 1710000000,
      }),
    ).toBe(false);
    expect(
      verifySlackInteractionSignature({
        signingSecret: secret,
        signatureHeader: signature,
        timestampHeader: timestamp,
        rawBody: body,
        nowSec: 1710000000 + 600,
      }),
    ).toBe(false);
  });

  it("parses form-encoded payload", () => {
    const payload = {
      type: "block_actions",
      actions: [{ action_id: "hdc:approve:task-a" }],
    };
    const raw = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    expect(parseSlackInteractionPayload(raw)?.type).toBe("block_actions");
  });

  it("slackMrkdwnFromDecisionMessage converts Discord bold to Slack mrkdwn", () => {
    expect(slackMrkdwnFromDecisionMessage("already **approved**")).toBe("already *approved*");
  });

  it("buildSlackReplaceOriginalAck returns replace_original blocks ack", () => {
    const ack = buildSlackReplaceOriginalAck("Done");
    expect(ack.replace_original).toBe(true);
    expect(ack.text).toBe("Done");
    expect(ack.blocks).toHaveLength(1);
  });

  it("handleSlackInteractionPayload approves a task via synchronous ack", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-slack-"));
    temps.push(root);
    const tasksDir = join(root, "operations", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(
      join(tasksDir, "task-a.md"),
      `---
id: task-a
role: hdc-sre-ops
priority: medium
status: pending
needs_decision: true
title: Test task
created_at: 2026-07-14T00:00:00.000Z
updated_at: 2026-07-14T00:00:00.000Z
---

Body
`,
      "utf8",
    );

    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => "ok" }));
    const result = await handleSlackInteractionPayload({
      privateRoot: root,
      fetchFn,
      payload: {
        type: "block_actions",
        response_url: "https://hooks.slack.example.invalid/response",
        user: { username: "alice" },
        message: { text: "Please approve task-a" },
        actions: [{ action_id: "hdc:approve:task-a" }],
      },
    });
    expect(result.status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.body.replace_original).toBe(true);
    expect(result.body.text).toContain("Approved");
    expect(buildSlackUpdatedDecisionText("x", "Approved", "alice")).toContain("@alice");
  });

  it("handleSlackInteractionPayload returns ephemeral for unknown action", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-slack-"));
    temps.push(root);
    const result = await handleSlackInteractionPayload({
      privateRoot: root,
      payload: {
        type: "block_actions",
        user: { username: "alice" },
        actions: [{ action_id: "not-a-decision" }],
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      response_type: "ephemeral",
      text: "Unknown decision button.",
    });
  });

  it("resolveSlackDecisionAuthorizedUsers parses comma-separated env", () => {
    expect(
      resolveSlackDecisionAuthorizedUsers({
        HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk,U01234567",
      }),
    ).toEqual(["dukk", "U01234567"]);
    expect(resolveSlackDecisionAuthorizedUsers({})).toEqual([]);
  });

  it("isSlackUserAuthorized matches username or user id", () => {
    expect(isSlackUserAuthorized({ username: "dukk" }, ["dukk"])).toBe(true);
    expect(isSlackUserAuthorized({ username: "Dukk" }, ["dukk"])).toBe(true);
    expect(isSlackUserAuthorized({ id: "U01234567" }, ["U01234567"])).toBe(true);
    expect(isSlackUserAuthorized({ username: "other" }, ["dukk"])).toBe(false);
    expect(isSlackUserAuthorized({ username: "anyone" }, [])).toBe(true);
  });

  it("handleSlackInteractionPayload denies unauthorized users", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-slack-"));
    temps.push(root);
    const tasksDir = join(root, "operations", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(
      join(tasksDir, "task-a.md"),
      `---
id: task-a
role: hdc-sre-ops
priority: medium
status: pending
needs_decision: true
title: Test task
created_at: 2026-07-14T00:00:00.000Z
updated_at: 2026-07-14T00:00:00.000Z
---

Body
`,
      "utf8",
    );

    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => "ok" }));
    const result = await handleSlackInteractionPayload({
      privateRoot: root,
      fetchFn,
      env: { HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk" },
      payload: {
        type: "block_actions",
        response_url: "https://hooks.slack.example.invalid/response",
        user: { username: "intruder" },
        message: { text: "Please approve task-a" },
        actions: [{ action_id: "hdc:approve:task-a" }],
      },
    });
    expect(result.status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.body).toEqual({
      response_type: "ephemeral",
      text: "Not authorized to approve/deny HDC tasks.",
    });
  });

  it("handleSlackInteractionPayload allows authorized username", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-slack-"));
    temps.push(root);
    const tasksDir = join(root, "operations", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(
      join(tasksDir, "task-a.md"),
      `---
id: task-a
role: hdc-sre-ops
priority: medium
status: pending
needs_decision: true
title: Test task
created_at: 2026-07-14T00:00:00.000Z
updated_at: 2026-07-14T00:00:00.000Z
---

Body
`,
      "utf8",
    );

    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => "ok" }));
    const result = await handleSlackInteractionPayload({
      privateRoot: root,
      fetchFn,
      env: { HDC_SLACK_DECISION_AUTHORIZED_USERS: "dukk" },
      payload: {
        type: "block_actions",
        response_url: "https://hooks.slack.example.invalid/response",
        user: { username: "dukk" },
        message: { text: "Please approve task-a" },
        actions: [{ action_id: "hdc:approve:task-a" }],
      },
    });
    expect(result.status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.body.replace_original).toBe(true);
    expect(result.body.text).toContain("Approved");
  });
});
