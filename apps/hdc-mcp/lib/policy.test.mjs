import { describe, expect, it } from "vitest";

import {
  ALLOWED_RUN_VERBS,
  assertAllowedRunVerb,
  assertNoDestructiveRunFlags,
  assertNotBlockedCommand,
  normalizeTier,
} from "./policy.mjs";

describe("hdc-mcp policy", () => {
  it("normalizes infra to infrastructure", () => {
    expect(normalizeTier("infra")).toBe("infrastructure");
    expect(normalizeTier("service")).toBe("service");
  });

  it("rejects invalid tiers", () => {
    expect(() => normalizeTier("azure")).toThrow(/invalid tier/);
  });

  it("allows query and maintain only", () => {
    expect(assertAllowedRunVerb("query")).toBe("query");
    expect(assertAllowedRunVerb("maintain")).toBe("maintain");
    expect(() => assertAllowedRunVerb("deploy")).toThrow(/not allowed/);
  });

  it("blocks secrets and deploy top-level commands", () => {
    expect(() => assertNotBlockedCommand("secrets")).toThrow(/not allowed/);
    expect(() => assertNotBlockedCommand("users")).toThrow(/not allowed/);
  });

  it("blocks destructive run flags", () => {
    expect(() => assertNoDestructiveRunFlags(["--prune"])).toThrow(/--prune/);
    expect(() => assertNoDestructiveRunFlags(["--dry-run"])).not.toThrow();
  });

  it("documents allowed verbs set", () => {
    expect([...ALLOWED_RUN_VERBS]).toEqual(["query", "maintain"]);
  });
});
