import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  appendSuggestion,
  listQueuedTopics,
  listTopics,
  readTopic,
  updateTopic,
  writeResearchIndex,
  writeTopic,
} from "./research-topics.mjs";

describe("research-topics", () => {
  it("appendSuggestion creates inbox and appends entry", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-research-"));
    try {
      const r = appendSuggestion(root, {
        title: "Test tool",
        url: "https://example.invalid/tool",
        body: "Worth a look.",
        source: "web-ui",
      });
      expect(r.title).toBe("Test tool");
      const text = readFileSync(r.path, "utf8");
      expect(text).toContain("Research suggestions");
      expect(text).toContain("Test tool");
      expect(text).toContain("https://example.invalid/tool");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("listQueuedTopics returns only queued topics sorted by priority", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-research-"));
    try {
      writeTopic(root, {
        id: "topic-a",
        title: "A",
        status: "queued",
        priority: "low",
        url: "",
        suggested_by: "operator",
        report: "",
        outcome: "",
        created_at: "2026-07-14T00:00:00Z",
        updated_at: "2026-07-14T00:00:00Z",
        body: "",
      });
      writeTopic(root, {
        id: "topic-b",
        title: "B",
        status: "done",
        priority: "high",
        url: "",
        suggested_by: "operator",
        report: "operations/reports/research-topic-b.md",
        outcome: "defer",
        created_at: "2026-07-14T00:00:00Z",
        updated_at: "2026-07-14T01:00:00Z",
        body: "",
      });
      writeTopic(root, {
        id: "topic-c",
        title: "C",
        status: "queued",
        priority: "high",
        url: "",
        suggested_by: "operator",
        report: "",
        outcome: "",
        created_at: "2026-07-14T00:00:00Z",
        updated_at: "2026-07-14T00:00:00Z",
        body: "",
      });

      const queued = listQueuedTopics(root);
      expect(queued.map((t) => t.id)).toEqual(["topic-c", "topic-a"]);
      expect(listTopics(root)).toHaveLength(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writeResearchIndex regenerates markdown table", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-research-"));
    try {
      writeTopic(root, {
        id: "macos-pve",
        title: "macOS on PVE",
        status: "done",
        priority: "low",
        url: "https://github.com/jvivs/osx-proxmox",
        suggested_by: "operator",
        report: "operations/reports/research-topic-macos-pve-2026-07-14.md",
        outcome: "manual-only",
        created_at: "2026-07-14T00:00:00Z",
        updated_at: "2026-07-14T02:00:00Z",
        body: "notes",
      });
      const path = writeResearchIndex(root, { source: "test" });
      const md = readFileSync(path, "utf8");
      expect(md).toContain("macos-pve");
      expect(md).toContain("manual-only");
      expect(md).toContain("research-topic-macos-pve");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("updateTopic patches fields", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-research-"));
    try {
      const topicsDir = join(root, "operations", "research", "topics");
      mkdirSync(topicsDir, { recursive: true });
      writeFileSync(
        join(topicsDir, "foo.md"),
        [
          "---",
          "id: foo",
          'title: "Foo"',
          "status: queued",
          "priority: low",
          "suggested_by: operator",
          "created_at: 2026-07-14T00:00:00Z",
          "updated_at: 2026-07-14T00:00:00Z",
          "---",
          "",
          "body text",
          "",
        ].join("\n"),
        "utf8",
      );
      updateTopic(root, "foo", { status: "in_progress" });
      const t = readTopic(root, "foo");
      expect(t.status).toBe("in_progress");
      expect(t.body).toBe("body text");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
