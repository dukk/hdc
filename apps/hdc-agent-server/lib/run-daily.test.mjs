import { describe, expect, it } from "vitest";
import { parseRunDailyArgv } from "./run-daily.mjs";

describe("parseRunDailyArgv", () => {
  it("parses --on-failure-only", () => {
    const opts = parseRunDailyArgv(["--on-failure-only", "--skip-discord"]);
    expect(opts.onFailureOnly).toBe(true);
    expect(opts.skipDiscord).toBe(true);
  });
});
