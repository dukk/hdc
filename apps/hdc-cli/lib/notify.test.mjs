import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "notify.mjs");
const preload = pathToFileURL(join(here, "package", "preload.mjs")).href;
const nodeImport = ["--import", preload];

describe("notify.mjs", () => {
  it("dry-run prints route channels", () => {
    const r = spawnSync(
      process.execPath,
      [
        ...nodeImport,
        script,
        "--dry-run",
        "--route",
        "needs_decision",
        "--message",
        "task needs approval",
        "--title",
        "HDC decision",
      ],
      { encoding: "utf8", env: { ...process.env, HDC_SECRET_BACKEND: "local" } },
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.route).toBe("needs_decision");
    expect(Array.isArray(parsed.channels)).toBe(true);
  });

  it("requires --route", () => {
    const r = spawnSync(process.execPath, [...nodeImport, script, "--message", "x"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--route is required");
  });

  it("requires --task-id with --decision", () => {
    const r = spawnSync(
      process.execPath,
      [...nodeImport, script, "--route", "needs_decision", "--message", "x", "--decision"],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--task-id is required");
  });
});
