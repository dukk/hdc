import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyQueryToSidecar,
  automationTargetIds,
  companionMarkdownPath,
  findInventorySidecars,
  loadAutomatedSystemsDoc,
  loadManualInventoryIdKindMap,
  MARKER_END,
  MARKER_START,
  mergeAutomatedSystemsFromPlugin,
  mergeQueryStdoutIntoAutomationInventory,
  renderInventoryMarkdown,
  resolveSystemById,
  scanForSecrets,
  syncMarkdownMarkers,
  validateSidecar,
} from "./inventory.mjs";

function writeTree(root, /** @type {Record<string, string>} */ files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
}

describe("inventory", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("companionMarkdownPath maps sidecar to markdown", () => {
    expect(companionMarkdownPath("/x/foo.inventory.json")).toBe("/x/foo.md");
    expect(companionMarkdownPath("/x/foo.json")).toBeNull();
  });

  it("validateSidecar catches structural issues", () => {
    const ids = new Set(["nagios"]);
    expect(validateSidecar(null, ids)).toContain("root must be a JSON object");
    expect(validateSidecar([], ids)).toContain("root must be a JSON object");
    expect(
      validateSidecar(
        { schema_version: 2, id: "", kind: "legacy", automation_targets: ["nope"] },
        ids,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("validateSidecar accepts proxmox_cluster and rejects invalid shape", () => {
    const ids = new Set(["nagios"]);
    const ok = validateSidecar(
      {
        schema_version: 1,
        id: "pve-x",
        kind: "system",
        automation_targets: ["nagios"],
        proxmox_cluster: { id: "proxmox-primary-cluster", role: "node" },
      },
      ids,
    );
    expect(ok).toEqual([]);

    const badRole = validateSidecar(
      {
        schema_version: 1,
        id: "pve-x",
        kind: "system",
        proxmox_cluster: { id: "c", role: "primary" },
      },
      ids,
    );
    expect(badRole.some((x) => x.includes("proxmox_cluster.role"))).toBe(true);

    const extraKey = validateSidecar(
      {
        schema_version: 1,
        id: "pve-x",
        kind: "system",
        proxmox_cluster: { id: "c", role: "node", foo: 1 },
      },
      ids,
    );
    expect(extraKey.some((x) => x.includes("unknown key"))).toBe(true);
  });

  it("validateSidecar accepts minimal valid record", () => {
    const ids = new Set(["nagios"]);
    const o = {
      schema_version: 1,
      id: "s1",
      kind: "system",
      automation_targets: ["nagios"],
    };
    expect(validateSidecar(o, ids)).toEqual([]);
  });

  it("validateSidecar requires target automation_target and known manifest id", () => {
    const ids = new Set(["nagios"]);
    const missing = validateSidecar({ schema_version: 1, id: "t", kind: "target" }, ids);
    expect(missing.some((x) => x.includes("automation_target"))).toBe(true);

    const badRef = validateSidecar(
      { schema_version: 1, id: "t", kind: "target", automation_target: "missing" },
      ids,
    );
    expect(badRef.some((x) => x.includes("automation_target"))).toBe(true);

    const ok = validateSidecar(
      { schema_version: 1, id: "t", kind: "target", automation_target: "nagios", data: { x: 1 } },
      ids,
    );
    expect(ok).toEqual([]);
  });

  it("validateSidecar requires hosted_on_system_id for virtual systems", () => {
    const ids = new Set();
    const bad = validateSidecar(
      {
        schema_version: 1,
        id: "vm1",
        kind: "system",
        system_class: "virtual",
      },
      ids,
    );
    expect(bad.some((x) => x.includes("hosted_on_system_id"))).toBe(true);

    const ok = validateSidecar(
      {
        schema_version: 1,
        id: "vm1",
        kind: "system",
        system_class: "virtual",
        hosted_on_system_id: "pve-cluster",
      },
      ids,
    );
    expect(ok).toEqual([]);
  });

  it("validateSidecar validates auth refs and nested auth", () => {
    const ids = new Set();
    const bad = validateSidecar(
      {
        schema_version: 1,
        id: "a",
        kind: "network",
        auth: { api: "lowercase" },
      },
      ids,
    );
    expect(bad.some((x) => x.includes("expected env var name"))).toBe(true);

    const nested = validateSidecar(
      {
        schema_version: 1,
        id: "b",
        kind: "network",
        auth: { svc: { TOKEN: "HDC_OK" } },
      },
      ids,
    );
    expect(nested).toEqual([]);
  });

  it("scanForSecrets flags suspicious strings", () => {
    const longB64 = `${"A".repeat(90)}${"=".repeat(20)}`;
    const hits = scanForSecrets({
      k1: "-----BEGIN PRIVATE KEY-----\nMII",
      k2: longB64,
      k3: "password=super-secret-value-that-is-long-enough",
    });
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("findInventorySidecars lists sorted inventory files", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    writeTree(root, {
      "inventory/manual/net/b.inventory.json": "{}",
      "inventory/manual/net/a.inventory.json": "{}",
    });
    const paths = findInventorySidecars(root);
    expect(paths.map((p) => p.replace(/\\/g, "/")).sort()).toEqual(
      [
        join(root, "inventory/manual/net/a.inventory.json").replace(/\\/g, "/"),
        join(root, "inventory/manual/net/b.inventory.json").replace(/\\/g, "/"),
      ].sort(),
    );
  });

  it("automationTargetIds reads manifest id or falls back", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    writeTree(root, {
      "automation/one/manifest.json": JSON.stringify({ id: " explicit ", verbs: {} }),
      "automation/two/manifest.json": "bad",
      "automation/three/manifest.json": JSON.stringify({ verbs: {} }),
    });
    const ids = automationTargetIds(root);
    expect([...ids].sort()).toEqual(["explicit", "three", "two"]);
  });

  it("renderInventoryMarkdown renders hardware and access tables", () => {
    const md = renderInventoryMarkdown({
      hardware: [
        {
          name: "n|1",
          description: "d\nx",
          cpu: "c",
          cores: "4",
          memory: "8G",
          memory_capacity: "",
          storage: "ssd",
          storage_capacity: "1T",
        },
      ],
      access: {
        nodes: [
          { name: "n", hostnames: ["h"], ip: "10.0.0.1", web_ui: "https://x", ssh: "ssh://y" },
        ],
      },
    });
    expect(md).toContain("## Hardware (synced)");
    expect(md).toContain("\\|");
    expect(md).toContain("## Network (synced)");
    expect(md).toContain("[Web UI](https://x)");
  });

  it("renderInventoryMarkdown placeholder when nothing to render", () => {
    const md = renderInventoryMarkdown({});
    expect(md).toContain("_No tabular inventory fields to render._");
  });

  it("syncMarkdownMarkers updates or dry-runs", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    const mdPath = join(root, "x.md");
    const inner = "OLD";
    writeFileSync(
      mdPath,
      `head\n${MARKER_START}\n${inner}\n${MARKER_END}\ntail\n`,
      "utf8",
    );
    const r1 = syncMarkdownMarkers(mdPath, "NEW\n", true);
    expect(r1.ok).toBe(true);
    expect(readFileSync(mdPath, "utf8")).toContain("OLD");

    const r2 = syncMarkdownMarkers(mdPath, "NEW\n", false);
    expect(r2.ok).toBe(true);
    expect(readFileSync(mdPath, "utf8")).toContain("NEW");
    expect(readFileSync(mdPath, "utf8")).not.toContain("OLD");

    const r3 = syncMarkdownMarkers(join(root, "missing.md"), "x", false);
    expect(r3.ok).toBe(false);

    writeFileSync(join(root, "bad.md"), "no markers\n", "utf8");
    const r4 = syncMarkdownMarkers(join(root, "bad.md"), "x", false);
    expect(r4.ok).toBe(false);

    writeFileSync(join(root, "rev.md"), `${MARKER_END}\n${MARKER_START}\n`, "utf8");
    const r5 = syncMarkdownMarkers(join(root, "rev.md"), "x", false);
    expect(r5.ok).toBe(false);
  });

  it("findInventorySidecars returns empty when inventory/manual missing", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    expect(findInventorySidecars(join(root, "no-inv"))).toEqual([]);
  });

  it("automationTargetIds returns empty when automation missing", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    expect([...automationTargetIds(join(root, "no-auto"))]).toEqual([]);
  });

  it("validateSidecar rejects invalid optional fields", () => {
    const ids = new Set();
    const issues = validateSidecar(
      {
        schema_version: 1,
        id: "x",
        kind: "network",
        access: [],
        tags: [1],
        last_verified: 3,
        notes: 9,
      },
      ids,
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("applyQueryToSidecar merges query payload", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    const side = join(root, "s.inventory.json");
    const q = join(root, "q.json");
    writeFileSync(side, JSON.stringify({ schema_version: 1, id: "i", kind: "network" }), "utf8");
    writeFileSync(q, JSON.stringify({ ok: true }), "utf8");
    applyQueryToSidecar(side, q);
    const data = JSON.parse(readFileSync(side, "utf8"));
    expect(data.query_last).toEqual({ ok: true });
    expect(typeof data.last_verified).toBe("string");
  });

  it("mergeQueryStdoutIntoAutomationInventory writes and merges", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    const inv = join(root, "inventory.json");
    const r1 = mergeQueryStdoutIntoAutomationInventory(inv, '{"a":1}\n');
    expect(r1.ok).toBe(true);
    let d = JSON.parse(readFileSync(inv, "utf8"));
    expect(d.query_last).toEqual({ a: 1 });
    const r2 = mergeQueryStdoutIntoAutomationInventory(inv, '{"b":2}');
    expect(r2.ok).toBe(true);
    d = JSON.parse(readFileSync(inv, "utf8"));
    expect(d.query_last).toEqual({ b: 2 });
    expect(d.a).toBeUndefined();

    writeFileSync(inv, JSON.stringify({ custom: true, query_last: { old: 1 }, last_verified: "x" }), "utf8");
    const r3 = mergeQueryStdoutIntoAutomationInventory(inv, '{"c":3}');
    expect(r3.ok).toBe(true);
    d = JSON.parse(readFileSync(inv, "utf8"));
    expect(d.custom).toBe(true);
    expect(d.query_last).toEqual({ c: 3 });
  });

  it("mergeQueryStdoutIntoAutomationInventory rejects bad stdout", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    const inv = join(root, "inventory.json");
    expect(mergeQueryStdoutIntoAutomationInventory(inv, "").ok).toBe(false);
    expect(mergeQueryStdoutIntoAutomationInventory(inv, "not-json").ok).toBe(false);
    expect(mergeQueryStdoutIntoAutomationInventory(inv, "[1,2]").ok).toBe(false);
    expect(existsSync(inv)).toBe(false);
  });

  it("mergeAutomatedSystemsFromPlugin merges systems array and resolveSystemById overlays automated", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    writeTree(root, {
      "inventory/manual/systems/h.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "h",
        kind: "system",
        system_class: "physical",
        notes: "manual",
      }),
    });
    mergeAutomatedSystemsFromPlugin(root, "plug", "query", {
      systems: [{ id: "h", system_class: "virtual", hosted_on_system_id: "host-1" }],
    });
    const doc = loadAutomatedSystemsDoc(root);
    expect(doc.systems.h).toMatchObject({ id: "h", hosted_on_system_id: "host-1" });
    const merged = resolveSystemById(root, "h");
    expect(merged).toMatchObject({
      id: "h",
      notes: "manual",
      hosted_on_system_id: "host-1",
      system_class: "virtual",
    });
  });

  it("loadManualInventoryIdKindMap detects duplicate ids", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    writeTree(root, {
      "inventory/manual/systems/a.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "dup",
        kind: "system",
      }),
      "inventory/manual/services/b.inventory.json": JSON.stringify({
        schema_version: 1,
        id: "dup",
        kind: "services",
      }),
    });
    const { duplicateIds } = loadManualInventoryIdKindMap(root, (p) => readFileSync(p, "utf8"));
    expect(duplicateIds).toContain("dup");
  });

  it("validateSidecar resolves system.services refs against id index", () => {
    const ids = new Set(["nagios"]);
    const idToKind = new Map([
      ["svc-a", "services"],
      ["svc-b", "network"],
    ]);
    const badKind = validateSidecar(
      {
        schema_version: 1,
        id: "host",
        kind: "system",
        services: [{ id: "svc-b" }],
      },
      ids,
      { idToKind },
    );
    expect(badKind.some((x) => x.includes("must reference kind services"))).toBe(true);

    const missing = validateSidecar(
      {
        schema_version: 1,
        id: "host",
        kind: "system",
        access: { nodes: [{ name: "n1", ip: "10.0.0.1" }] },
        services: [{ id: "nope" }],
      },
      ids,
      { idToKind },
    );
    expect(missing.some((x) => x.includes("no inventory sidecar"))).toBe(true);

    const badNode = validateSidecar(
      {
        schema_version: 1,
        id: "host",
        kind: "system",
        access: { nodes: [{ name: "n1", ip: "10.0.0.1" }] },
        services: [{ id: "svc-a", nodes: ["n2"] }],
      },
      ids,
      { idToKind },
    );
    expect(badNode.some((x) => x.includes("not an access.nodes[].name"))).toBe(true);

    const ok = validateSidecar(
      {
        schema_version: 1,
        id: "host",
        kind: "system",
        access: { nodes: [{ name: "n1", ip: "10.0.0.1" }] },
        services: [{ id: "svc-a" }, { id: "svc-a", nodes: ["n1"] }],
      },
      ids,
      { idToKind },
    );
    expect(ok).toEqual([]);
  });
});
