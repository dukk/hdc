import { describe, expect, it } from "vitest";

import {
  formatA2aAgentDescription,
  matchesAugmentorCriteria,
  parseA2aMetadataTags,
  parseAugmentorMetadata,
} from "./litellm-a2a-metadata.mjs";

describe("litellm-a2a-metadata", () => {
  it("formats fleet and augmentor descriptions with hdc-a2a tags", () => {
    const fleet = formatA2aAgentDescription({
      name: "hdc-sre-engineer",
      description: "HDC package engineer",
      kind: "fleet",
    });
    expect(fleet).toContain("[hdc-a2a kind=fleet]");

    const aug = formatA2aAgentDescription({
      name: "cursor-cli-clumps",
      description: "Cursor CLI augmentor",
      kind: "augmentor",
      runtime: "cursor-cli",
      repos: ["hdc-clumps"],
      delegatable_by: ["hdc-sre-engineer"],
    });
    expect(aug).toContain("runtime=cursor-cli");
    expect(aug).toContain("repos=hdc-clumps");
    expect(aug).toContain("delegatable_by=hdc-sre-engineer");
  });

  it("parses tags from agent card description", () => {
    const tags = parseA2aMetadataTags(
      "Cursor CLI [hdc-a2a kind=augmentor runtime=cursor-cli repos=hdc-clumps delegatable_by=hdc-sre-engineer]",
    );
    expect(tags).toMatchObject({
      kind: "augmentor",
      runtime: "cursor-cli",
      repos: "hdc-clumps",
      delegatable_by: "hdc-sre-engineer",
    });
  });

  it("filters augmentors by repo and delegator role", () => {
    const entry = {
      name: "cursor-cli-clumps",
      kind: "augmentor",
      repos: ["hdc-clumps"],
      delegatable_by: ["hdc-sre-engineer"],
    };
    expect(matchesAugmentorCriteria(entry, { delegatorRole: "hdc-sre-engineer", repo: "hdc-clumps" })).toBe(
      true,
    );
    expect(matchesAugmentorCriteria(entry, { delegatorRole: "hdc-qa", repo: "hdc-clumps" })).toBe(
      false,
    );
    const meta = parseAugmentorMetadata(null, { ...entry, enabled: false });
    expect(meta.enabled).toBe(false);
  });
});
