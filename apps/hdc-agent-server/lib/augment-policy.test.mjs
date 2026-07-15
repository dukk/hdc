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
        "hdc-engineer",
        "hdc-network-architect",
        "hdc-qa",
        "hdc-research",
        "hdc-security-architect",
        "hdc-security-expert",
        "hdc-sre-engineer",
      ].sort(),
    );
  });

  it("defaults repo to first allowed entry", () => {
    expect(defaultRepoForRole("hdc-engineer")).toBe("hdc");
    expect(defaultRepoForRole("hdc-sre-engineer")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-qa")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-research")).toBe("hdc");
    expect(defaultRepoForRole("hdc-security-expert")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-security-architect")).toBe("hdc-clumps");
    expect(defaultRepoForRole("hdc-network-architect")).toBe("hdc-clumps");
  });

  it("accepts allowed repos and rejects others", () => {
    expect(() => assertRepoAllowedForRole("hdc-qa", "hdc")).not.toThrow();
    expect(() => assertRepoAllowedForRole("hdc-qa", "hdc-clumps")).not.toThrow();
    expect(() => assertRepoAllowedForRole("hdc-engineer", "hdc-clumps")).toThrow(/may only delegate/);
    expect(() => assertRepoAllowedForRole("hdc-sre-engineer", "hdc")).toThrow(/may only delegate/);
    expect(() => assertRepoAllowedForRole("hdc-research", "hdc-private")).toThrow(/must be/);
    expect(() => assertRepoAllowedForRole("hdc-manager", "hdc")).toThrow(/may not delegate/);
  });

  it("never includes hdc-private in allowlists", () => {
    for (const repos of Object.values(REPOS_BY_ROLE)) {
      expect(repos).not.toContain("hdc-private");
      for (const r of repos) {
        expect(["hdc", "hdc-clumps"]).toContain(r);
      }
    }
  });
});
