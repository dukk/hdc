import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotenv } from "./env.mjs";

describe("loadDotenv", () => {
  /** @type {string[]} */
  const keysTouched = [];
  let root = "";

  afterEach(() => {
    for (const k of keysTouched) {
      delete process.env[k];
    }
    keysTouched.length = 0;
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("no-ops when file is missing", () => {
    loadDotenv(join(tmpdir(), "missing-env-" + Date.now()), false);
  });

  it("parses unquoted, quoted, export prefix, and escape sequences", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-dotenv-"));
    const p = join(root, ".env");
    writeFileSync(
      p,
      [
        "  # comment",
        "",
        "HDC_DOTENV_A=plain",
        'HDC_DOTENV_B="dq"',
        "HDC_DOTENV_C='sq'",
        "export HDC_DOTENV_D=ex",
        "HDC_DOTENV_E=line1\\nline2",
      ].join("\n"),
      "utf8",
    );
    keysTouched.push("HDC_DOTENV_A", "HDC_DOTENV_B", "HDC_DOTENV_C", "HDC_DOTENV_D", "HDC_DOTENV_E");
    for (const k of keysTouched) delete process.env[k];

    loadDotenv(p, false);
    expect(process.env.HDC_DOTENV_A).toBe("plain");
    expect(process.env.HDC_DOTENV_B).toBe("dq");
    expect(process.env.HDC_DOTENV_C).toBe("sq");
    expect(process.env.HDC_DOTENV_D).toBe("ex");
    expect(process.env.HDC_DOTENV_E).toBe("line1\nline2");
  });

  it("respects override flag", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-dotenv-"));
    const p = join(root, ".env");
    writeFileSync(p, "HDC_DOTENV_OV=second\n", "utf8");
    keysTouched.push("HDC_DOTENV_OV");
    process.env.HDC_DOTENV_OV = "first";
    loadDotenv(p, false);
    expect(process.env.HDC_DOTENV_OV).toBe("first");
    loadDotenv(p, true);
    expect(process.env.HDC_DOTENV_OV).toBe("second");
  });
});
