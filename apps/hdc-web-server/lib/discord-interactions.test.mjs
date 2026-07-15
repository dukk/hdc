import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDiscordTaskDecision,
  buildUpdatedDecisionContent,
  DISCORD_CALLBACK_PONG,
  DISCORD_CALLBACK_UPDATE_MESSAGE,
  DISCORD_INTERACTION_MESSAGE_COMPONENT,
  DISCORD_INTERACTION_PING,
  handleDiscordInteractionPayload,
  parseDecisionCustomId,
  verifyDiscordInteractionSignature,
} from "./discord-interactions.mjs";

describe("discord-interactions", () => {
  /** @type {string[]} */
  const temps = [];

  afterEach(() => {
    for (const d of temps.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("parseDecisionCustomId accepts approve/deny", () => {
    expect(parseDecisionCustomId("hdc:approve:2026-07-14-sre-foo")).toEqual({
      action: "approve",
      taskId: "2026-07-14-sre-foo",
    });
    expect(parseDecisionCustomId("hdc:deny:task-a")).toEqual({
      action: "deny",
      taskId: "task-a",
    });
    expect(parseDecisionCustomId("other:approve:x")).toBeNull();
  });

  it("verifyDiscordInteractionSignature accepts valid Ed25519 signatures", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const jwk = /** @type {{ x: string }} */ (publicKey.export({ format: "jwk" }));
    const publicKeyHex = Buffer.from(jwk.x, "base64url").toString("hex");
    const timestamp = "1234567890";
    const rawBody = Buffer.from('{"type":1}', "utf8");
    const message = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
    const signatureHex = sign(null, message, privateKey).toString("hex");

    expect(
      verifyDiscordInteractionSignature({
        publicKeyHex,
        signatureHex,
        timestamp,
        rawBody,
      }),
    ).toBe(true);

    expect(
      verifyDiscordInteractionSignature({
        publicKeyHex,
        signatureHex: "00".repeat(64),
        timestamp,
        rawBody,
      }),
    ).toBe(false);
  });

  it("handleDiscordInteractionPayload answers PING", () => {
    const result = handleDiscordInteractionPayload({
      body: { type: DISCORD_INTERACTION_PING },
      privateRoot: "/tmp/unused",
    });
    expect(result.status).toBe(200);
    expect(result.body.type).toBe(DISCORD_CALLBACK_PONG);
  });

  it("applyDiscordTaskDecision approves and denies tasks", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-discord-tasks-"));
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

    const approved = applyDiscordTaskDecision(root, { action: "approve", taskId: "task-a" });
    expect(approved.ok).toBe(true);
    expect(approved.status).toBe("approved");

    const again = applyDiscordTaskDecision(root, { action: "approve", taskId: "task-a" });
    expect(again.already).toBe(true);

    writeFileSync(
      join(tasksDir, "task-b.md"),
      `---
id: task-b
role: hdc-sre-ops
priority: medium
status: pending
needs_decision: true
title: Deny me
created_at: 2026-07-14T00:00:00.000Z
updated_at: 2026-07-14T00:00:00.000Z
---

Body
`,
      "utf8",
    );
    const denied = applyDiscordTaskDecision(root, { action: "deny", taskId: "task-b" });
    expect(denied.ok).toBe(true);
    expect(denied.status).toBe("blocked");
  });

  it("handleDiscordInteractionPayload updates message and clears components", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-discord-tasks-"));
    temps.push(root);
    const tasksDir = join(root, "operations", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(
      join(tasksDir, "task-c.md"),
      `---
id: task-c
role: hdc-sre-ops
priority: high
status: pending
needs_decision: true
title: Click me
created_at: 2026-07-14T00:00:00.000Z
updated_at: 2026-07-14T00:00:00.000Z
---

Body
`,
      "utf8",
    );

    const result = handleDiscordInteractionPayload({
      privateRoot: root,
      body: {
        type: DISCORD_INTERACTION_MESSAGE_COMPONENT,
        data: { custom_id: "hdc:approve:task-c" },
        message: { content: "Task task-c needs a decision." },
      },
    });
    expect(result.body.type).toBe(DISCORD_CALLBACK_UPDATE_MESSAGE);
    const data = /** @type {Record<string, unknown>} */ (result.body.data);
    expect(data.components).toEqual([]);
    expect(String(data.content)).toContain("Approved");
  });

  it("buildUpdatedDecisionContent appends outcome", () => {
    expect(buildUpdatedDecisionContent("hello", "done")).toBe("hello\n\n_done_");
  });
});
