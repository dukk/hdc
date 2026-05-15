import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  automatedSystemsDocMissingSystemRow,
  LOCAL_HOST_INVENTORY_PLUGIN_ID,
  localHostInventoryPayload,
  resolveManualSystemIdForLocalHost,
  shouldSkipLocalSystemInventoryCollection,
} from "./local-system-automated-inventory.mjs";

describe("local-system-automated-inventory", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("resolveManualSystemIdForLocalHost matches hostname and IP tokens", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-loc-"));
    mkdirSync(join(root, "inventory/manual/systems"), { recursive: true });
    writeFileSync(
      join(root, "inventory/manual/systems/a.inventory.json"),
      JSON.stringify({
        schema_version: 1,
        id: "sys-a",
        kind: "system",
        access: {
          nodes: [{ name: "n", hostnames: ["sys-a.example.org"], ip: "192.168.5.2", ssh: "ssh://root@sys-a.example.org" }],
        },
      }),
      "utf8",
    );
    const read = (p) => readFileSync(p, "utf8");
    expect(
      resolveManualSystemIdForLocalHost(root, read, {
        hostname: "sys-a",
        ips: [],
        platform: "linux",
        arch: "x64",
      }).id,
    ).toBe("sys-a");
    expect(
      resolveManualSystemIdForLocalHost(root, read, {
        hostname: "other",
        ips: ["192.168.5.2"],
        platform: "linux",
        arch: "x64",
      }).id,
    ).toBe("sys-a");
    expect(
      resolveManualSystemIdForLocalHost(root, read, {
        hostname: "nope",
        ips: [],
        platform: "linux",
        arch: "x64",
      }).id,
    ).toBe("");
  });

  it("resolveManualSystemIdForLocalHost flags ambiguous ids", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-loc-"));
    mkdirSync(join(root, "inventory/manual/systems"), { recursive: true });
    for (const id of ["z", "m"]) {
      writeFileSync(
        join(root, `inventory/manual/systems/${id}.inventory.json`),
        JSON.stringify({
          schema_version: 1,
          id,
          kind: "system",
          access: { nodes: [{ hostnames: ["shared"], ip: "10.0.0.1" }] },
        }),
        "utf8",
      );
    }
    const read = (p) => readFileSync(p, "utf8");
    const r = resolveManualSystemIdForLocalHost(root, read, {
      hostname: "shared",
      ips: [],
      platform: "linux",
      arch: "x64",
    });
    expect(r.ambiguous).toBe(true);
    expect(r.id).toBe("m");
  });

  it("shouldSkipLocalSystemInventoryCollection respects env and docs/help", () => {
    expect(shouldSkipLocalSystemInventoryCollection(["list"], {})).toBe(false);
    expect(shouldSkipLocalSystemInventoryCollection(["typo"], {})).toBe(true);
    expect(shouldSkipLocalSystemInventoryCollection(["inventory", "apply"], {})).toBe(false);
    expect(shouldSkipLocalSystemInventoryCollection(["inventory"], {})).toBe(true);
    expect(shouldSkipLocalSystemInventoryCollection(["docs", "lint"], {})).toBe(true);
    expect(shouldSkipLocalSystemInventoryCollection(["help"], {})).toBe(true);
    expect(shouldSkipLocalSystemInventoryCollection(["list"], { CI: "true" })).toBe(true);
    expect(shouldSkipLocalSystemInventoryCollection(["list"], { HDC_SKIP_LOCAL_SYSTEM_INVENTORY: "1" })).toBe(true);
  });

  it("automatedSystemsDocMissingSystemRow is true until systems[id] exists", () => {
    root = mkdtempSync(join(tmpdir(), "hdc-loc-"));
    expect(automatedSystemsDocMissingSystemRow(root, "x")).toBe(true);
    mkdirSync(join(root, "inventory/automated"), { recursive: true });
    writeFileSync(
      join(root, "inventory/automated/systems.json"),
      JSON.stringify({ schema_version: 1, systems: { x: { id: "x" } }, sources: {} }),
      "utf8",
    );
    expect(automatedSystemsDocMissingSystemRow(root, "x")).toBe(false);
  });

  it("localHostInventoryPayload carries hdc_local_host block", () => {
    const p = localHostInventoryPayload("pve-a", {
      hostname: "pve-a",
      ips: ["10.0.0.1"],
      platform: "linux",
      arch: "arm64",
    });
    expect(p.systems?.[0]?.id).toBe("pve-a");
    expect(p.systems?.[0]?.hdc_local_host).toEqual({
      hostname: "pve-a",
      ips: ["10.0.0.1"],
      platform: "linux",
      arch: "arm64",
    });
    expect(LOCAL_HOST_INVENTORY_PLUGIN_ID).toBe("hdc-local-host");
  });
});
