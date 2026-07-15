import { describe, expect, it } from "vitest";
import { detectJwtSigningIssues } from "hdc/clump/services/twenty/lib/query-status.mjs";

describe("twenty query jwt signing detection", () => {
  it("detectJwtSigningIssues flags signing and encryption key errors", () => {
    expect(
      detectJwtSigningIssues("error: No active signing key available to sign asymmetric token"),
    ).toEqual({
      healthy: false,
      error: "No active signing key available to sign asymmetric token",
    });
    expect(detectJwtSigningIssues("No encryption key matches keyId '70a204b5'")).toEqual({
      healthy: false,
      error: "No encryption key matches keyId",
    });
    expect(detectJwtSigningIssues("login ok")).toEqual({ healthy: true, error: null });
  });
});
