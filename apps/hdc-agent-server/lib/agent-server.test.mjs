import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { extractMessageText } from "./a2a-http.mjs";
import { createTaskQueue } from "./task-queue.mjs";
import { loadRolePrompt, rolePromptPath, stripFrontmatter } from "./role-prompt.mjs";
import { loadSkillsForRole, listFleetSkillIds } from "./skill-load.mjs";
import { defaultScheduleMinutes, resolveScheduleMinutes } from "./schedule.mjs";
import {
  canAutoRunTask,
  peerA2aBaseUrl,
  runDispatcher,
  sha256Hex,
} from "./dispatcher.mjs";
import { createTask, TASK_ROLES } from "./operations-fs.mjs";
import { buildAgentCard } from "./agent-card.mjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HDC_ROOT = join(PACKAGE_ROOT, "..", "..");

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

describe("role prompt paths", () => {
  it("loads from apps/hdc-agent-server/agents", () => {
    const path = rolePromptPath(HDC_ROOT, "hdc-manager");
    assert.match(path.replace(/\\/g, "/"), /hdc-agent-server\/agents\/hdc-manager\.md$/);
    const md = loadRolePrompt(HDC_ROOT, "hdc-manager");
    assert.match(md, /HDC Manager/);
    assert.doesNotMatch(md, /Cursor CLI/);
  });
});

describe("skill inject", () => {
  it("lists fleet skills and loads manager skills", () => {
    const ids = listFleetSkillIds(HDC_ROOT);
    assert.ok(ids.includes("hdc-agent-team"));
    assert.ok(ids.includes("hdc-manager"));
    const text = loadSkillsForRole(HDC_ROOT, "hdc-manager");
    assert.match(text, /hdc-agent-team|Task file/i);
  });
});

describe("agent card", () => {
  it("advertises fleet skills", () => {
    const card = buildAgentCard({
      role: "hdc-monitor",
      hostHeader: "127.0.0.1:9201",
      hdcRoot: HDC_ROOT,
    });
    assert.equal(card.name, "hdc-monitor");
    assert.ok(card.skills.some((s) => s.id === "hdc-monitor" || s.id === "hdc-agent-team"));
  });
});

describe("schedule", () => {
  it("defaults manager 15m monitor 60m", () => {
    assert.equal(defaultScheduleMinutes("hdc-manager"), 15);
    assert.equal(defaultScheduleMinutes("hdc-monitor"), 60);
    assert.equal(resolveScheduleMinutes("hdc-sre", {}), 0);
    assert.equal(resolveScheduleMinutes("hdc-monitor", { HDC_AGENT_SCHEDULE_MINUTES: "off" }), 0);
  });
});

describe("operations-fs roles", () => {
  it("includes hdc-engineer", () => {
    assert.ok(TASK_ROLES.includes("hdc-engineer"));
  });
});

describe("dispatcher", () => {
  it("idles when private root unset", () => {
    const r = runDispatcher({
      role: "hdc-manager",
      hdcRoot: HDC_ROOT,
      privateRoot: "",
    });
    assert.equal(r.invoked_llm, false);
    assert.equal(r.work.length, 0);
  });

  it("manager refreshes report and idles without new signals or runnable tasks", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-disp-"));
    try {
      mkdirSync(join(root, "operations", "tasks"), { recursive: true });
      mkdirSync(join(root, "operations", "reports"), { recursive: true });
      const r = runDispatcher({
        role: "hdc-manager",
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        nowMs: Date.now(),
        log: () => {},
      });
      assert.equal(r.work.length, 0);
      assert.ok(r.report_path);
      assert.match(r.idle_reason || "", /no new reports|no runnable/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("manager enqueues peer A2A for approved task", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-disp-"));
    try {
      mkdirSync(join(root, "operations", "tasks"), { recursive: true });
      mkdirSync(join(root, "operations", "reports"), { recursive: true });
      createTask(root, {
        id: "2026-07-14-approved-sre",
        role: "hdc-sre",
        status: "approved",
        priority: "high",
        title: "Fix immich",
        suggested_commands: ["node apps/hdc-cli/cli.mjs run service immich query -- --live"],
      });
      const r = runDispatcher({
        role: "hdc-manager",
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        nowMs: Date.now(),
        log: () => {},
      });
      assert.ok(r.work.length >= 1);
      const peer = r.work.find((w) => w.id === "task-2026-07-14-approved-sre");
      assert.ok(peer);
      assert.equal(peer.peer_url, "http://hdc-sre:9202");
      assert.equal(peerA2aBaseUrl("hdc-sre"), "http://hdc-sre:9202");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("canAutoRunTask allows approved", () => {
    assert.equal(
      canAutoRunTask({
        status: "approved",
        needs_decision: false,
        suggested_commands: [],
      }),
      true,
    );
    assert.equal(
      canAutoRunTask({
        status: "pending",
        needs_decision: false,
        suggested_commands: ["node apps/hdc-cli/cli.mjs run service x query"],
      }),
      true,
    );
    assert.equal(
      canAutoRunTask({
        status: "pending",
        needs_decision: true,
        suggested_commands: ["node apps/hdc-cli/cli.mjs run service x query"],
      }),
      false,
    );
  });

  it("research idles when brief exists", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-disp-"));
    try {
      const date = new Date().toISOString().slice(0, 10);
      mkdirSync(join(root, "operations", "reports"), { recursive: true });
      writeFileSync(join(root, "operations", "reports", `research-${date}.md`), "# already\n");
      const r = runDispatcher({
        role: "hdc-research",
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        nowMs: Date.now(),
        log: () => {},
      });
      assert.equal(r.work.length, 0);
      assert.match(r.idle_reason || "", /already exists/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sha256Hex is stable", () => {
    assert.equal(sha256Hex("a"), sha256Hex("a"));
    assert.notEqual(sha256Hex("a"), sha256Hex("b"));
  });
});
