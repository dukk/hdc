import { describe, expect, it } from "vitest";

/**
 * Mirrors private helpers in ollama-install.mjs for stable log formatting.
 * @param {string} text
 * @param {number} [max]
 */
function oneLine(text, max = 280) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * @param {{ status: number; stdout: string; stderr: string }} r
 */
function describePctExecFailure(r) {
  const parts = [];
  const err = oneLine(r.stderr);
  const out = oneLine(r.stdout);
  if (err) parts.push(err);
  else if (out) parts.push(out);
  else parts.push("(no output captured)");
  return parts.join(" | ");
}

describe("ollama install wait logging helpers", () => {
  it("describePctExecFailure prefers stderr", () => {
    expect(
      describePctExecFailure({
        status: 255,
        stderr: "CT 471 not running\n",
        stdout: "",
      }),
    ).toBe("CT 471 not running");
  });

  it("describePctExecFailure falls back to stdout", () => {
    expect(
      describePctExecFailure({
        status: 1,
        stderr: "",
        stdout: "configuration file not found",
      }),
    ).toBe("configuration file not found");
  });
});
