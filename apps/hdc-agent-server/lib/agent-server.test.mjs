import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractMessageText } from "./a2a-http.mjs";
import { createTaskQueue } from "./task-queue.mjs";
import { stripFrontmatter } from "./role-prompt.mjs";
import { defaultScheduleMinutes, resolveScheduleMinutes } from "./schedule.mjs";

describe("extractMessageText", () => {
  it("reads A2A 0.3 parts", () => {
    const text = extractMessageText({
      message: {
        role: "user",
        parts: [{ kind: "text", text: "hello agents" }],
      },
    });
    assert.equal(text, "hello agents");
  });
});

describe("task queue", () => {
  it("runs one task and completes", async () => {
    const q = createTaskQueue();
    const task = q.enqueue("t1", "ping", async () => "pong");
    assert.equal(task.status, "submitted");
    await new Promise((r) => setTimeout(r, 20));
    const done = q.get("t1");
    assert.equal(done?.status, "completed");
    assert.equal(done?.result, "pong");
  });
});

describe("stripFrontmatter", () => {
  it("removes yaml fence", () => {
    const out = stripFrontmatter("---\nname: x\n---\n\nBody here\n");
    assert.match(out, /Body here/);
  });
});

describe("schedule", () => {
  it("defaults monitor to 4h", () => {
    assert.equal(defaultScheduleMinutes("hdc-monitor"), 240);
    assert.equal(resolveScheduleMinutes("hdc-manager", {}), 0);
    assert.equal(resolveScheduleMinutes("hdc-monitor", { HDC_AGENT_SCHEDULE_MINUTES: "off" }), 0);
  });
});
