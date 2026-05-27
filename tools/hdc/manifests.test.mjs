import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverManifests,
  envRequired,
  formatManifestServiceInvoke,
  inventoryDocs,
  manifestById,
  manifestByTierAndId,
  manifestId,
  manifestPlatforms,
  manifestRunTier,
  manifestServices,
  manifestTitle,
  canonicalRunTier,
  parseRunTier,
  resolveRunInvocation,
  runScriptDir,
  runTiersUsage,
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
      "infrastructure/a/manifest.json": "not json",
      "infrastructure/b/manifest.json": JSON.stringify([]),
      "infrastructure/c/manifest.json": JSON.stringify({ id: "ok", title: "T", verbs: {} }),
    });
    const m = discoverManifests(root);
    expect(m.map((x) => manifestId(x)).sort()).toEqual(["ok"]);
    expect(manifestTitle(m[0])).toBe("T");
  });

  it("manifestId falls back to directory name", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "infrastructure/fromdir/manifest.json": JSON.stringify({ title: "x", verbs: {} }),
    });
    const m = discoverManifests(root);
    expect(manifestId(m[0])).toBe("fromdir");
  });

  it("manifestTitle falls back to id", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "services/x/manifest.json": JSON.stringify({ id: "onlyid", verbs: {} }),
    });
    const m = discoverManifests(root);
    expect(manifestTitle(m[0])).toBe("onlyid");
  });

  it("manifestById resolves or returns null", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "services/z/manifest.json": JSON.stringify({ id: "zid", verbs: {} }),
    });
    const m = discoverManifests(root);
    expect(manifestById(m, "zid")).toBeTruthy();
    expect(manifestById(m, "missing")).toBeNull();
  });

  it("envRequired and inventoryDocs tolerate bad shapes", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "infrastructure/p/manifest.json": JSON.stringify({
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

  it("manifestServices skips invalid rows and requires configured verb", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "infrastructure/p/manifest.json": JSON.stringify({
        id: "p",
        verbs: { deploy: { script: "run.mjs" } },
        services: [
          { id: "ok", title: "Create", verb: "deploy", invoke: "create-x", summary: "Does x" },
          { id: "bad-verb", title: "X", verb: "nope" },
          { id: "no-script", title: "Y", verb: "query" },
        ],
      }),
    });
    const m = discoverManifests(root)[0];
    const svc = manifestServices(m);
    expect(svc).toHaveLength(1);
    expect(svc[0].id).toBe("ok");
    expect(formatManifestServiceInvoke(svc[0], m)).toBe("run infrastructure p deploy -- create-x");
  });

  it("discovers clients tier platform packages", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "clients/windows/manifest.json": JSON.stringify({
        id: "windows",
        verbs: { maintain: { script: "run.mjs" } },
      }),
      "clients/ubuntu/manifest.json": JSON.stringify({
        id: "client-ubuntu",
        verbs: { query: { script: "run.mjs" } },
      }),
    });
    const m = discoverManifests(root);
    expect(manifestById(m, "windows")).toBeTruthy();
    expect(manifestById(m, "client-ubuntu")).toBeTruthy();
    expect(runScriptDir(manifestById(m, "windows"), null, "maintain").replace(/\\/g, "/")).toMatch(
      /clients\/windows\/maintain$/,
    );
  });

  it("parseRunTier and manifestRunTier map CLI tier to directory", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "packages/services/svc/manifest.json": JSON.stringify({ id: "svc", verbs: {} }),
      "packages/clients/win/manifest.json": JSON.stringify({ id: "win", verbs: {} }),
      "packages/infrastructure/pve/manifest.json": JSON.stringify({ id: "pve", verbs: {} }),
    });
    const m = discoverManifests(join(root, "packages"));
    expect(parseRunTier("service")).toBe("services");
    expect(parseRunTier("client")).toBe("clients");
    expect(parseRunTier("infra")).toBe("infrastructure");
    expect(parseRunTier("infrastructure")).toBe("infrastructure");
    expect(parseRunTier("nope")).toBeNull();
    expect(canonicalRunTier("infra")).toBe("infrastructure");
    expect(canonicalRunTier("infrastructure")).toBe("infrastructure");
    expect(canonicalRunTier("nope")).toBeNull();
    expect(runTiersUsage()).toContain("infra");
    expect(manifestRunTier(manifestById(m, "svc"))).toBe("service");
    expect(manifestRunTier(manifestById(m, "win"))).toBe("client");
    expect(manifestByTierAndId(m, "service", "svc")).toBeTruthy();
    expect(manifestByTierAndId(m, "infra", "pve")).toBeTruthy();
    expect(manifestByTierAndId(m, "client", "svc")).toBeNull();
    expect(manifestByTierAndId(m, "service", "win")).toBeNull();
  });

  it("resolveRunInvocation routes legacy platform manifest", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "clients/legacy/manifest.json": JSON.stringify({
        id: "legacy",
        platforms: ["windows"],
        verbs: { maintain: { script: "run.mjs" } },
      }),
    });
    const m = manifestById(discoverManifests(root), "legacy");
    expect(resolveRunInvocation(["legacy", "windows", "maintain"], m)).toEqual({
      packageId: "legacy",
      platform: "windows",
      verb: "maintain",
    });
  });

  it("verbSpec rejects invalid specs", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-manifests-"));
    writeTree(root, {
      "services/q/manifest.json": JSON.stringify({
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
