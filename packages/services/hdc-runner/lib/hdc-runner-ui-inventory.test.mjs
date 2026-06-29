import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import {
  listInventoryCategory,
  getInventoryRecord,
} from "./hdc-runner-ui-inventory.mjs";
import {
  validatePackageRun,
  parseArgsString,
  normalizeCliArgs,
} from "./hdc-runner-ui-packages.mjs";

describe("hdc-runner-ui-inventory", () => {
  it("lists and gets inventory from fixture dir", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    const systemsDir = join(root, "inventory", "manual", "systems");
    mkdirSync(systemsDir, { recursive: true });
    writeFileSync(
      join(systemsDir, "test-host-a.json"),
      JSON.stringify({
        kind: "system",
        id: "test-host-a",
        hostname: "test-host-a",
        access: { nodes: [{ ip: "192.0.2.99" }] },
      }),
    );

    const list = listInventoryCategory(root, root, "systems");
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe("test-host-a");
    expect(list.items[0].primary_ip).toBe("192.0.2.99");

    const detail = getInventoryRecord(root, root, "systems", "test-host-a");
    expect(detail.record?.id).toBe("test-host-a");
    expect(getInventoryRecord(root, root, "systems", "../etc/passwd").error).toBe("invalid id");
  });
});

describe("hdc-runner-ui-packages", () => {
  const installRoot = repoRoot();

  it("validatePackageRun allows query/maintain for known package", async () => {
    const ok = await validatePackageRun(installRoot, "service", "bind", "query", [
      "query",
      "maintain",
    ]);
    expect(ok.ok).toBe(true);

    const bad = await validatePackageRun(installRoot, "service", "bind", "deploy", [
      "query",
      "maintain",
    ]);
    expect(bad.ok).toBe(false);
  });

  it("parseArgsString rejects shell metacharacters", () => {
    expect(parseArgsString("--dry-run")).toEqual(["--dry-run"]);
    expect(() => parseArgsString("foo; rm -rf /")).toThrow(/metacharacters/);
  });

  it("normalizeCliArgs rejects newlines", () => {
    expect(normalizeCliArgs(["--instance", "a"])).toEqual(["--instance", "a"]);
    expect(() => normalizeCliArgs(["bad\narg"])).toThrow();
  });
});
