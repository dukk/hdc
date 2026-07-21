import { describe, expect, it } from "vitest";

import { VALID_CATEGORIES } from "./inventory.mjs";

describe("hdc-web inventory categories", () => {
  it("includes domains", () => {
    expect(VALID_CATEGORIES.has("domains")).toBe(true);
    expect(VALID_CATEGORIES.has("systems")).toBe(true);
  });
});
