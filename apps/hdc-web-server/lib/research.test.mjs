import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getResearchPayload, postResearchSuggestion } from "./research.mjs";

describe("web research api", () => {
  it("postResearchSuggestion requires session for api-token", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-web-research-"));
    try {
      const r = postResearchSuggestion(root, { title: "X" }, { user: "api-token", sessionOnly: true });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("postResearchSuggestion appends for session user", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-web-research-"));
    try {
      const r = postResearchSuggestion(
        root,
        { title: "Tool Y", url: "https://example.invalid", body: "notes" },
        { user: "dukk@dukk.org", sessionOnly: true },
      );
      expect(r.ok).toBe(true);
      const payload = getResearchPayload(root);
      expect(payload.suggestions).toContain("Tool Y");
      expect(payload.suggestions).toContain("web-ui:dukk@dukk.org");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
