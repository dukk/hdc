import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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
    expect(text).toBe("hello agents");
  });
});

describe("task queue", () => {
  it("runs one task and completes", async () => {
    const q = createTaskQueue();
    const task = q.enqueue("t1", "ping", async () => "pong");
    expect(task.status).toBe("submitted");
    await new Promise((r) => setTimeout(r, 20));
    const done = q.get("t1");
    expect(done?.status).toBe("completed");
    expect(done?.result).toBe("pong");
  });
});

describe("stripFrontmatter", () => {
  it("removes yaml fence", () => {
    const out = stripFrontmatter("---\nname: x\n---\n\nBody here\n");
    expect(out).toMatch(/Body here/);
  });
});

describe("role prompt paths", () => {
  it("loads from apps/hdc-agent-server/agents", () => {
    const path = rolePromptPath(HDC_ROOT, "hdc-manager");
    expect(path.replace(/\\/g, "/")).toMatch(/hdc-agent-server\/agents\/hdc-manager\.md$/);
    const md = loadRolePrompt(HDC_ROOT, "hdc-manager");
    expect(md).toMatch(/HDC Manager/);
    expect(md).not.toMatch(/Cursor CLI/);
  });
});

describe("skill inject", () => {
  it("lists fleet skills and loads manager skills", () => {
    const ids = listFleetSkillIds(HDC_ROOT);
    expect(ids).toContain("hdc-agent-team");
    expect(ids).toContain("hdc-manager");
    const text = loadSkillsForRole(HDC_ROOT, "hdc-manager");
    expect(text).toMatch(/hdc-agent-team|Task file/i);
  });
});

describe("agent card", () => {
  it("advertises fleet skills", () => {
    const card = buildAgentCard({
      role: "hdc-monitor",
      hostHeader: "127.0.0.1:9201",
      hdcRoot: HDC_ROOT,
    });
    expect(card.name).toBe("hdc-monitor");
    expect(card.skills.some((s) => s.id === "hdc-monitor" || s.id === "hdc-agent-team")).toBe(true);
  });
});

describe("schedule", () => {
  it("defaults manager 15m monitor 60m", () => {
    expect(defaultScheduleMinutes("hdc-manager")).toBe(15);
    expect(defaultScheduleMinutes("hdc-monitor")).toBe(60);
    expect(resolveScheduleMinutes("hdc-sre-ops", {})).toBe(0);
    expect(resolveScheduleMinutes("hdc-monitor", { HDC_AGENT_SCHEDULE_MINUTES: "off" })).toBe(0);
  });
});

describe("operations-fs roles", () => {
  it("includes build and ops roles", () => {
    expect(TASK_ROLES).toContain("hdc-engineer");
    expect(TASK_ROLES).toContain("hdc-sre-engineer");
    expect(TASK_ROLES).toContain("hdc-sre-ops");
  });
});

describe("dispatcher", () => {
  it("idles when private root unset", async () => {
    const r = await runDispatcher({
      role: "hdc-manager",
      hdcRoot: HDC_ROOT,
      privateRoot: "",
    });
    expect(r.invoked_llm).toBe(false);
    expect(r.work.length).toBe(0);
  });

  it("manager refreshes report and idles without new signals or runnable tasks", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-disp-"));
    try {
      mkdirSync(join(root, "operations", "tasks"), { recursive: true });
      mkdirSync(join(root, "operations", "reports"), { recursive: true });
      const r = await runDispatcher({
        role: "hdc-manager",
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        nowMs: Date.now(),
        log: () => {},
      });
      expect(r.work.length).toBe(0);
      expect(r.report_path).toBeTruthy();
      expect(r.idle_reason || "").toMatch(/no new reports|no runnable/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("manager enqueues peer A2A for approved task", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-disp-"));
    try {
      mkdirSync(join(root, "operations", "tasks"), { recursive: true });
      mkdirSync(join(root, "operations", "reports"), { recursive: true });
      createTask(root, {
        id: "2026-07-14-approved-sre",
        role: "hdc-sre-ops",
        status: "approved",
        priority: "high",
        title: "Fix immich",
        suggested_commands: ["hdc run service immich query -- --live"],
      });
      const r = await runDispatcher({
        role: "hdc-manager",
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        nowMs: Date.now(),
        log: () => {},
      });
      expect(r.work.length).toBeGreaterThanOrEqual(1);
      const peer = r.work.find((w) => w.id === "task-2026-07-14-approved-sre");
      expect(peer).toBeTruthy();
      expect(peer?.peer_url).toBe("http://hdc-sre-ops:9202");
      expect(peerA2aBaseUrl("hdc-sre-ops")).toBe("http://hdc-sre-ops:9202");
      expect(peerA2aBaseUrl("hdc-sre")).toBe("http://hdc-sre-ops:9202");
      expect(peerA2aBaseUrl("hdc-sre-engineer")).toBe("http://hdc-sre-engineer:9208");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("canAutoRunTask allows approved", () => {
    expect(
      canAutoRunTask({
        status: "approved",
        needs_decision: false,
        suggested_commands: [],
      }),
    ).toBe(true);
    expect(
      canAutoRunTask({
        status: "pending",
        needs_decision: false,
        suggested_commands: ["hdc run service x query"],
      }),
    ).toBe(true);
    expect(
      canAutoRunTask({
        status: "pending",
        needs_decision: true,
        suggested_commands: ["hdc run service x query"],
      }),
    ).toBe(false);
  });

  it("research idles when brief exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-disp-"));
    try {
      const date = new Date().toISOString().slice(0, 10);
      mkdirSync(join(root, "operations", "reports"), { recursive: true });
      writeFileSync(join(root, "operations", "reports", `research-${date}.md`), "# already\n");
      const r = await runDispatcher({
        role: "hdc-research",
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        nowMs: Date.now(),
        log: () => {},
      });
      expect(r.work.length).toBe(0);
      expect(r.idle_reason || "").toMatch(/already exists/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("research runs queued topics even when daily brief exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-disp-"));
    try {
      const date = new Date().toISOString().slice(0, 10);
      mkdirSync(join(root, "operations", "reports"), { recursive: true });
      mkdirSync(join(root, "operations", "research", "topics"), { recursive: true });
      writeFileSync(join(root, "operations", "reports", `research-${date}.md`), "# already\n");
      writeFileSync(
        join(root, "operations", "research", "topics", "queued-one.md"),
        [
          "---",
          "id: queued-one",
          'title: "Queued topic"',
          "status: queued",
          "priority: low",
          "suggested_by: operator",
          "created_at: 2026-07-14T00:00:00Z",
          "updated_at: 2026-07-14T00:00:00Z",
          "---",
          "",
        ].join("\n"),
        "utf8",
      );
      const r = await runDispatcher({
        role: "hdc-research",
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        nowMs: Date.now(),
        log: () => {},
      });
      expect(r.work.length).toBe(1);
      expect(r.work[0].prompt || "").toMatch(/queued-one/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sha256Hex is stable", () => {
    expect(sha256Hex("a")).toBe(sha256Hex("a"));
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});
