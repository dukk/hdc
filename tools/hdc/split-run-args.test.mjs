import { describe, expect, it } from "vitest";
import { splitRunArgs } from "./lib/split-run-args.mjs";

describe("splitRunArgs", () => {
  it("returns full argv as forward when no delimiter", () => {
    expect(splitRunArgs(["a", "b"])).toEqual({ forward: ["a", "b"], extra: [] });
  });

  it("splits at first --", () => {
    expect(splitRunArgs(["t", "query", "--", "x", "y"])).toEqual({
      forward: ["t", "query"],
      extra: ["x", "y"],
    });
  });

  it("treats trailing -- as empty extra", () => {
    expect(splitRunArgs(["t", "v", "--"])).toEqual({
      forward: ["t", "v"],
      extra: [],
    });
  });
});
