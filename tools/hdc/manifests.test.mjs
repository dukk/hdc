import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverManifests,
  envRequired,
  inventoryDocs,
  manifestById,
  manifestId,
  manifestTitle,
  verbSpec,
} from "./manifests.mjs";

function writeTree(root, /** @type {Record<string, string>} */ files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
}

describe("manifests", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("discoverManifests returns empty for missing directory", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    expect(discoverManifests(join(root, "nope"))).toEqual([]);
  });

  it("discoverManifests skips broken JSON and non-objects", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "a/manifest.json": "not json",
      "b/manifest.json": JSON.stringify([]),
      "c/manifest.json": JSON.stringify({ id: "ok", title: "T", verbs: {} }),
    });
    const m = discoverManifests(root);
    expect(m.map((x) => manifestId(x)).sort()).toEqual(["ok"]);
    expect(manifestTitle(m[0])).toBe("T");
  });

  it("manifestId falls back to directory name", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "fromdir/manifest.json": JSON.stringify({ title: "x", verbs: {} }),
    });
    const m = discoverManifests(root);
    expect(manifestId(m[0])).toBe("fromdir");
  });

  it("manifestTitle falls back to id", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "x/manifest.json": JSON.stringify({ id: "onlyid", verbs: {} }),
    });
    const m = discoverManifests(root);
    expect(manifestTitle(m[0])).toBe("onlyid");
  });

  it("manifestById resolves or returns null", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "z/manifest.json": JSON.stringify({ id: "zid", verbs: {} }),
    });
    const m = discoverManifests(root);
    expect(manifestById(m, "zid")).toBeTruthy();
    expect(manifestById(m, "missing")).toBeNull();
  });

  it("envRequired and inventoryDocs tolerate bad shapes", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "p/manifest.json": JSON.stringify({
        id: "p",
        env_required: ["A", 1],
        inventory_docs: ["a.md", 2],
        verbs: {},
      }),
    });
    const m = discoverManifests(root)[0];
    expect(envRequired(m)).toEqual(["A", "1"]);
    expect(inventoryDocs(m)).toEqual(["a.md", "2"]);
  });

  it("verbSpec rejects invalid specs", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "q/manifest.json": JSON.stringify({
        id: "q",
        verbs: {
          deploy: "not-object",
          maintain: { script: "" },
          query: { script: "run.mjs" },
        },
      }),
    });
    const m = discoverManifests(root)[0];
    expect(verbSpec(m, "deploy")).toBeNull();
    expect(verbSpec(m, "maintain")).toBeNull();
    expect(verbSpec(m, "query")).toEqual({ script: "run.mjs" });
  });
});
