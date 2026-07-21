import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTaskDecision } from "./task-decision.mjs";

describe("task-decision dispatch hook", () => {
  /** @type {string[]} */
  const temps = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const d of temps.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("applyTaskDecision triggers manager dispatch on approve", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-task-decision-"));
    temps.push(root);
    mkdirSync(join(root, "operations", "tasks"), { recursive: true });
    writeFileSync(
      join(root, "operations", "tasks", "task-run.md"),
      `---
id: task-run
role: hdc-sre-ops
priority: high
status: pending
needs_decision: true
title: Run fix
created_at: 2026-07-14T00:00:00.000Z
updated_at: 2026-07-14T00:00:00.000Z
suggested_commands:
  - hdc run service immich query -- --live
---

Body
`,
      "utf8",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, dispatched: true }),
      })),
    );
    process.env.HDC_WEB_API_TOKEN = "test-token";

    const result = await applyTaskDecision(
      root,
      { action: "approve", taskId: "task-run" },
      { user: "discord" },
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe("approved");
    expect(result.message).toContain("Execution dispatched");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
