import { describe, expect, it } from "vitest";
import { CliExit } from "./lib/cli-exit.mjs";

describe("CliExit", () => {
  it("carries exit code", () => {
    const e = new CliExit(3);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(3);
  });
});
