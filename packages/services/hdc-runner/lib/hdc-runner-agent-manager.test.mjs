import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canAutoRunTask } from "./hdc-runner-agent-manager.mjs";
import { buildAgentPrompt, agentCliMode } from "./hdc-runner-agent-run.mjs";
import { collectAgentBundlePaths } from "./hdc-runner-sync-agents.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("hdc-runner-agent-manager", () => {
  it("canAutoRunTask allows approved tasks", () => {
    expect(
      canAutoRunTask({
        id: "t1",
        role: "hdc-sre",
        priority: "high",
        status: "approved",
        title: "x",
        created_at: "",
        updated_at: "",
        needs_decision: false,
        evidence: [],
        suggested_commands: [],
        body: "",
      }),
    ).toBe(true);
  });

  it("canAutoRunTask allows query-only pending tasks", () => {
    expect(
      canAutoRunTask({
        id: "t2",
        role: "hdc-monitor",
        priority: "low",
        status: "pending",
        title: "q",
        created_at: "",
        updated_at: "",
        needs_decision: false,
        evidence: [],
        suggested_commands: ["node tools/hdc/cli.mjs run service immich query -- --live"],
        body: "",
      }),
    ).toBe(true);
  });

  it("canAutoRunTask rejects pending with needs_decision", () => {
    expect(
      canAutoRunTask({
        id: "t3",
        role: "hdc-sre",
        priority: "high",
        status: "pending",
        title: "d",
        created_at: "",
        updated_at: "",
        needs_decision: true,
        evidence: [],
        suggested_commands: ["node tools/hdc/cli.mjs run service nginx-waf maintain -- --prune"],
        body: "",
      }),
    ).toBe(false);
  });
});

describe("hdc-runner-agent-run", () => {
  it("buildAgentPrompt includes task path", () => {
    const p = buildAgentPrompt({
      installRoot: "/opt/hdc",
      privateRoot: "/opt/hdc-private",
      role: "hdc-sre",
      taskId: "task-a",
    });
    expect(p).toContain("operations/tasks/task-a.md");
  });

  it("agentCliMode uses plan for architects", () => {
    expect(agentCliMode("hdc-security-architect")).toBe("plan");
    expect(agentCliMode("hdc-sre")).toBe("agent");
  });
});

describe("hdc-runner-sync-agents", () => {
  it("collectAgentBundlePaths finds hdc agents", () => {
    const paths = collectAgentBundlePaths(REPO_ROOT);
    expect(paths.some((p) => p.endsWith("hdc-manager.md"))).toBe(true);
    expect(paths.some((p) => p.includes("hdc-agent-team"))).toBe(true);
  });
});
