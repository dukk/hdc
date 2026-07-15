import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { validateClump } from "./clump-validate.mjs";

describe("validateClump", () => {
  it("reports missing clumps root", () => {
    const r = validateClump({
      clumpsRoot: join(tmpdir(), "no-such-clumps-root"),
      hdcRoot: tmpdir(),
      tier: "service",
      clump: "foo",
    });
    expect(r.ok).toBe(false);
    expect(r.findings[0]?.code).toBe("clumps_root_missing");
  });

  it("passes a minimal valid package", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-clump-val-"));
    try {
      const pkg = join(root, "services", "demo");
      mkdirSync(join(pkg, "query"), { recursive: true });
      writeFileSync(
        join(pkg, "manifest.json"),
        JSON.stringify({
          id: "demo",
          title: "Demo",
          verbs: { query: { script: "query/run.mjs" } },
        }),
        "utf8",
      );
      writeFileSync(join(pkg, "query", "run.mjs"), "process.stderr.write('ok\\n');\n", "utf8");
      writeFileSync(join(pkg, "config.example.json"), "{}\n", "utf8");
      const hdcRoot = mkdtempSync(join(tmpdir(), "hdc-schema-"));
      mkdirSync(join(hdcRoot, "apps", "hdc-cli", "schema"), { recursive: true });
      writeFileSync(join(hdcRoot, "apps", "hdc-cli", "schema", "demo.config.schema.json"), "{}\n");

      const r = validateClump({
        clumpsRoot: root,
        hdcRoot,
        tier: "service",
        clump: "demo",
      });
      expect(r.ok).toBe(true);
      expect(r.summary.errors).toBe(0);
      rmSync(hdcRoot, { recursive: true, force: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags missing verb script and config.example", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-clump-val-"));
    try {
      const pkg = join(root, "services", "broken");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(
        join(pkg, "manifest.json"),
        JSON.stringify({
          id: "broken",
          verbs: { query: { script: "query/run.mjs" } },
        }),
        "utf8",
      );
      const r = validateClump({
        clumpsRoot: root,
        hdcRoot: root,
        tier: "service",
        clump: "broken",
      });
      expect(r.ok).toBe(false);
      expect(r.findings.some((f) => f.code === "verb_script_missing")).toBe(true);
      expect(r.findings.some((f) => f.code === "config_example_missing")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
