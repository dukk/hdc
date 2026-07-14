import { describe, expect, it } from "vitest";

import {
  ALLOWED_RUN_VERBS,
  assertAllowedRunVerb,
  assertApprovedTaskForDeploy,
  assertNoDestructiveRunFlags,
  assertNotBlockedCommand,
  assertToolAllowedForRole,
  getRolePolicy,
  normalizeTier,
  parseTaskFrontmatterStatus,
  resolveAgentRole,
} from "./policy.mjs";

describe("hdc-mcp-server policy", () => {
  it("normalizes infra to infrastructure", () => {
    expect(normalizeTier("infra")).toBe("infrastructure");
    expect(normalizeTier("service")).toBe("service");
  });

  it("rejects invalid tiers", () => {
    expect(() => normalizeTier("azure")).toThrow(/invalid tier/);
  });

  it("allows query, health, and maintain for default role", () => {
    expect(assertAllowedRunVerb("query", "default")).toBe("query");
    expect(assertAllowedRunVerb("health", "default")).toBe("health");
    expect(assertAllowedRunVerb("maintain", "default")).toBe("maintain");
    expect(() => assertAllowedRunVerb("deploy", "default")).toThrow(/not allowed/);
  });

  it("restricts read-only roles to query and health", () => {
    expect(assertAllowedRunVerb("query", "hdc-monitor")).toBe("query");
    expect(assertAllowedRunVerb("health", "hdc-monitor")).toBe("health");
    expect(() => assertAllowedRunVerb("maintain", "hdc-monitor")).toThrow(/not allowed/);
    expect(() => assertAllowedRunVerb("maintain", "hdc-engineer")).toThrow(/not allowed/);
  });

  it("allows deploy for sre/manager only with role policy", () => {
    expect(assertAllowedRunVerb("deploy", "hdc-sre")).toBe("deploy");
    expect(getRolePolicy("hdc-sre").allowDeployWithApprovedTask).toBe(true);
  });

  it("blocks tools by role", () => {
    expect(() => assertToolAllowedForRole("hdc_maintain_daily", "hdc-engineer")).toThrow(
      /not allowed/,
    );
    expect(() => assertToolAllowedForRole("hdc_list", "hdc-engineer")).not.toThrow();
  });

  it("resolves HDC_AGENT_ROLE from env", () => {
    expect(resolveAgentRole({})).toBe("default");
    expect(resolveAgentRole({ HDC_AGENT_ROLE: "hdc-monitor" })).toBe("hdc-monitor");
  });

  it("blocks secrets and deploy top-level commands", () => {
    expect(() => assertNotBlockedCommand("secrets")).toThrow(/not allowed/);
    expect(() => assertNotBlockedCommand("users")).toThrow(/not allowed/);
  });

  it("blocks destructive run flags", () => {
    expect(() => assertNoDestructiveRunFlags(["--prune"])).toThrow(/--prune/);
    expect(() => assertNoDestructiveRunFlags(["--dry-run"])).not.toThrow();
  });

  it("documents default allowed verbs set", () => {
    expect([...ALLOWED_RUN_VERBS]).toEqual(["query", "health", "maintain"]);
  });

  it("parses task frontmatter status", () => {
    const md = `---
id: t1
status: approved
---
body
`;
    expect(parseTaskFrontmatterStatus(md)).toBe("approved");
  });

  it("requires approved task for deploy", () => {
    const files = new Map([
      [
        "ok",
        `---
status: approved
---
`,
      ],
      [
        "pending",
        `---
status: pending
---
`,
      ],
    ]);
    const exists = (p) => {
      const id = String(p).replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/, "");
      return files.has(id ?? "");
    };
    const readFile = (p) => {
      const id = String(p).replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/, "");
      return files.get(id ?? "") ?? "";
    };
    expect(() =>
      assertApprovedTaskForDeploy({
        verb: "deploy",
        taskId: "ok",
        role: "hdc-sre",
        privateRoot: "/priv",
        exists,
        readFile,
      }),
    ).not.toThrow();
    expect(() =>
      assertApprovedTaskForDeploy({
        verb: "deploy",
        taskId: "pending",
        role: "hdc-sre",
        privateRoot: "/priv",
        exists,
        readFile,
      }),
    ).toThrow(/approved/);
    expect(() =>
      assertApprovedTaskForDeploy({
        verb: "deploy",
        role: "hdc-sre",
        privateRoot: "/priv",
      }),
    ).toThrow(/task_id/);
  });
});
