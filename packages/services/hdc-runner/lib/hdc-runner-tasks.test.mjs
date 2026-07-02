import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTask,
  listTasks,
  parseFrontmatter,
  readTask,
  renderTaskReport,
  serializeTask,
  updateTaskStatus,
  validateTaskFrontmatter,
  writeTask,
  writeTaskReport,
} from "./hdc-runner-tasks.mjs";

describe("hdc-runner-tasks", () => {
  it("parseFrontmatter reads yaml lists and body", () => {
    const raw = `---
id: test-task
role: hdc-sre
priority: high
status: pending
evidence:
  - operations/reports/monitor-2026-06-29.md
suggested_commands:
  - "node tools/hdc/cli.mjs run service immich query -- --live"
---
Investigate Immich monitor failure.
`;
    const { meta, body } = parseFrontmatter(raw);
    expect(meta.id).toBe("test-task");
    expect(meta.evidence).toEqual(["operations/reports/monitor-2026-06-29.md"]);
    expect(body).toBe("Investigate Immich monitor failure.");
  });

  it("validateTaskFrontmatter rejects invalid role", () => {
    expect(() =>
      validateTaskFrontmatter({ id: "x", role: "bad", status: "pending", priority: "low" }),
    ).toThrow(/invalid role/);
  });

  it("write/read round-trip", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-tasks-"));
    try {
      const task = createTask(root, {
        id: "2026-06-29-monitor-immich",
        role: "hdc-sre",
        priority: "high",
        title: "Immich monitor down",
        evidence: ["operations/reports/monitor-2026-06-29.md"],
        suggested_commands: ["node tools/hdc/cli.mjs run service immich query -- --live"],
        body: "Immich Uptime Kuma monitor failing.",
      });
      expect(task.status).toBe("pending");

      const loaded = readTask(root, task.id);
      expect(loaded.title).toBe("Immich monitor down");
      expect(loaded.body).toContain("Immich Uptime Kuma");

      const tasks = listTasks(root, { includeDone: true });
      expect(tasks).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("updateTaskStatus sets approved_at and completed_at", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-tasks-"));
    try {
      createTask(root, { id: "task-a", role: "hdc-sre", title: "Do thing" });
      const approved = updateTaskStatus(root, "task-a", { status: "approved" });
      expect(approved.approved_at).toBeTruthy();
      const done = updateTaskStatus(root, "task-a", { status: "done" });
      expect(done.completed_at).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renderTaskReport includes open tasks and counts", () => {
    const tasks = [
      validateTaskFrontmatter(
        {
          id: "a",
          role: "hdc-sre",
          priority: "critical",
          status: "pending",
          title: "Fix edge",
          created_at: "2026-06-29T08:00:00Z",
          updated_at: "2026-06-29T08:00:00Z",
        },
        "",
      ),
      validateTaskFrontmatter(
        {
          id: "b",
          role: "hdc-monitor",
          priority: "low",
          status: "done",
          title: "Sweep",
          created_at: "2026-06-29T07:00:00Z",
          updated_at: "2026-06-29T07:30:00Z",
          completed_at: "2026-06-29T07:30:00Z",
        },
        "",
      ),
    ];
    const md = renderTaskReport(tasks, { source: "test", now: "2026-06-29T09:00:00Z" });
    expect(md).toContain("# HDC Task Report");
    expect(md).toContain("| a | hdc-sre | critical | pending | Fix edge |");
    expect(md).not.toContain("| b |");
    expect(md).toContain("pending: 1");
  });

  it("writeTaskReport writes file", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-tasks-"));
    try {
      createTask(root, { id: "t1", role: "hdc-manager", title: "Triage" });
      const path = writeTaskReport(root, listTasks(root, { includeDone: true }), {
        source: "agent-manager-hourly",
      });
      const md = readFileSync(path, "utf8");
      expect(md).toContain("agent-manager-hourly");
      expect(md).toContain("t1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serializeTask produces valid frontmatter", () => {
    const task = validateTaskFrontmatter(
      {
        id: "x",
        role: "hdc-sre",
        priority: "medium",
        status: "pending",
        title: "Hello | world",
        created_at: "2026-06-29T08:00:00Z",
        updated_at: "2026-06-29T08:00:00Z",
      },
      "Body text",
    );
    const text = serializeTask(task);
    const { meta, body } = parseFrontmatter(text);
    expect(meta.id).toBe("x");
    expect(body).toBe("Body text");
  });
});
