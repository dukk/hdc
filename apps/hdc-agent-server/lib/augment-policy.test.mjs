import { describe, expect, it } from "vitest";

import {
  AUGMENT_DELEGATOR_ROLES,
  REPOS_BY_ROLE,
  assertRepoAllowedForRole,
  defaultRepoForRole,
} from "./augment-policy.mjs";

describe("augment-policy", () => {
  it("lists all delegating roles", () => {
    expect([...AUGMENT_DELEGATOR_ROLES].sort()).toEqual(
      [
        "hdc-network-architect",
        "hdc-qa",
        "hdc-research",
        "hdc-security-architect",
        "hdc-security-expert",
        "hdc-sre-engineer",
      ].sort(),
    );
  });

  it("defaults repo to hdc-clumps for every role", () => {
    expect(defaultRepoForRole("hdc-sre-engineer")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-qa")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-research")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-security-expert")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-security-architect")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-network-architect")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-engineer")).toBe("");
  });

  it("accepts hdc-clumps and rejects hdc", () => {
    expect(() => assertRepoAllowedForRole("hdc-qa", "hdc-clumps")).not.toThrow();
    expect(() => assertRepoAllowedForRole("hdc-sre-engineer", "hdc-clumps")).not.toThrow();
    expect(() => assertRepoAllowedForRole("hdc-qa", "hdc")).toThrow(/must be "hdc-clumps"/);
    expect(() => assertRepoAllowedForRole("hdc-sre-engineer", "hdc")).toThrow(/must be "hdc-clumps"/);
    expect(() => assertRepoAllowedForRole("hdc-research", "hdc-private")).toThrow(/must be/);
    expect(() => assertRepoAllowedForRole("hdc-manager", "hdc-clumps")).toThrow(/may not delegate/);
  });

  it("never includes hdc or hdc-private in allowlists", () => {
    for (const repos of Object.values(REPOS_BY_ROLE)) {
      expect(repos).not.toContain("hdc-private");
      expect(repos).not.toContain("hdc");
      for (const r of repos) {
        expect(r).toBe("hdc-clumps");
      }
    }
  });
});
