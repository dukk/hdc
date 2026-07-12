import { describe, expect, it } from "vitest";
import { readLineMasked } from "./readline-masked.mjs";

describe("readLineMasked", () => {
  it("exports a function", () => {
    expect(typeof readLineMasked).toBe("function");
  });
});
