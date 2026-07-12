import { describe, expect, it } from "vitest";

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "notify-discord.mjs");

describe("notify-discord.mjs", () => {
  it("dry-run exits 0 with JSON stdout", () => {
    const r = spawnSync(process.execPath, [script, "--dry-run", "--message", "test"], {
      encoding: "utf8",
      env: { ...process.env, HDC_SECRET_BACKEND: "local" },
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.dry_run).toBe(true);
  });

  it("requires --message", () => {
    const r = spawnSync(process.execPath, [script, "--dry-run"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });
});
