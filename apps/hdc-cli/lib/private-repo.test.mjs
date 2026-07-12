import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatRepoJson,
  formatResolvedRepoFileLabel,
  hdcPrivateRoot,
  normalizeRepoRelPath,
  preferredNewFilePath,
  preferredClumpReportPath,
  readResolvedRepoJson,
  resolveRepoFile,
  writeResolvedRepoJson,
} from "./private-repo.mjs";

describe("private-repo", () => {
  /** @type {string} */
  let publicRoot;
  /** @type {string} */
  let privateRoot;

  beforeEach(() => {
    publicRoot = mkdtempSync(join(tmpdir(), "hdc-public-"));
    privateRoot = mkdtempSync(join(tmpdir(), "hdc-private-"));
  });

  afterEach(() => {
    rmSync(publicRoot, { recursive: true, force: true });
    rmSync(privateRoot, { recursive: true, force: true });
  });

  it("normalizeRepoRelPath normalizes slashes", () => {
    expect(normalizeRepoRelPath("clumps\\services\\bind\\config.json")).toBe(
      "clumps/services/bind/config.json",
    );
  });

  it("hdcPrivateRoot uses HDC_PRIVATE_ROOT when set", () => {
    const env = { HDC_PRIVATE_ROOT: privateRoot };
    expect(hdcPrivateRoot(publicRoot, env)).toBe(privateRoot);
  });

  it("resolveRepoFile prefers public over private", () => {
    const rel = "clumps/services/bind/config.json";
    mkdirSync(join(publicRoot, "clumps", "services", "bind"), { recursive: true });
    mkdirSync(join(privateRoot, "clumps", "services", "bind"), { recursive: true });
    writeFileSync(join(publicRoot, rel), '{"public":true}\n', "utf8");
    writeFileSync(join(privateRoot, rel), '{"private":true}\n', "utf8");

    const env = { HDC_PRIVATE_ROOT: privateRoot };
    const r = resolveRepoFile(publicRoot, rel, env);
    expect(r.source).toBe("public");
    expect(JSON.parse(readResolvedRepoJson(r).public)).toBe(true);
  });

  it("resolveRepoFile falls back to private when public missing", () => {
    const rel = "clumps/infrastructure/proxmox/config.json";
    mkdirSync(join(privateRoot, "clumps", "infrastructure", "proxmox"), { recursive: true });
    writeFileSync(join(privateRoot, rel), '{"private":true}\n', "utf8");

    const env = { HDC_PRIVATE_ROOT: privateRoot };
    const r = resolveRepoFile(publicRoot, rel, env);
    expect(r.source).toBe("private");
    expect(r.found).toBe(true);
    expect(JSON.parse(readResolvedRepoJson(r).private)).toBe(true);
  });

  it("resolveRepoFile returns missing when neither exists", () => {
    const r = resolveRepoFile(publicRoot, "clumps/services/missing/config.json", {
      HDC_PRIVATE_ROOT: privateRoot,
    });
    expect(r.found).toBe(false);
    expect(r.source).toBe("missing");
  });

  it("preferredNewFilePath targets private when available", () => {
    const rel = "clumps/services/bind/config.json";
    const env = { HDC_PRIVATE_ROOT: privateRoot };
    expect(preferredNewFilePath(publicRoot, rel, env)).toBe(join(privateRoot, rel));
  });

  it("preferredClumpReportPath targets private reports dir when available", () => {
    const packageRoot = join(publicRoot, "clumps", "services", "bind");
    mkdirSync(packageRoot, { recursive: true });
    const env = { HDC_PRIVATE_ROOT: privateRoot };
    const path = preferredClumpReportPath(
      publicRoot,
      packageRoot,
      "maintain-2026-05-26T12-00-00.md",
      env,
    );
    expect(path).toBe(
      join(privateRoot, "clumps", "services", "bind", "reports", "maintain-2026-05-26T12-00-00.md"),
    );
  });

  it("writeResolvedRepoJson writes to resolved path", () => {
    const rel = "inventory/manual/systems/vm-test-a.json";
    mkdirSync(join(privateRoot, "inventory", "manual", "systems"), { recursive: true });
    const env = { HDC_PRIVATE_ROOT: privateRoot };
    const r = resolveRepoFile(publicRoot, rel, env);
    r.found = true;
    r.source = "private";
    r.path = join(privateRoot, rel);
    writeResolvedRepoJson(r, { id: "vm-test-a", kind: "system" });
    const r2 = resolveRepoFile(publicRoot, rel, env);
    expect(r2.found).toBe(true);
    expect(readResolvedRepoJson(r2).id).toBe("vm-test-a");
  });

  it("formatResolvedRepoFileLabel includes hdc-private for private source", () => {
    const rel = "clumps/services/bind/config.json";
    const r = resolveRepoFile(publicRoot, rel, { HDC_PRIVATE_ROOT: privateRoot });
    r.found = true;
    r.source = "private";
    r.path = join(privateRoot, rel);
    expect(formatResolvedRepoFileLabel(r, publicRoot)).toContain("hdc-private");
  });

  it("formatRepoJson compacts zones[].records[] to one line per record", () => {
    const data = {
      schema_version: 1,
      zones: [
        {
          name: "example.invalid",
          records: [
            { type: "A", name: "@", data: "1.2.3.4", ttl: 1, proxied: true },
            { type: "CNAME", name: "www", data: "example.invalid", proxied: false },
          ],
        },
      ],
    };
    const text = formatRepoJson(data);
    expect(text).toContain('"name": "example.invalid"');
    expect(text).toMatch(
      /\{ "type": "A", "name": "@", "data": "1\.2\.3\.4", "ttl": 1, "proxied": true \}/,
    );
    expect(text).toMatch(/\{ "type": "CNAME", "name": "www", "data": "example.invalid", "proxied": false \}/);
    expect(text.split("\n").length).toBeLessThan(15);
    expect(JSON.parse(text.trimEnd())).toEqual(data);
  });

  it("formatRepoJson compacts port_forwards[] to one line per rule", () => {
    const data = {
      schema_version: 1,
      port_forwards: [
        { id: "pf-a", managed: true, name: "Rule A", enabled: false },
        { id: "pf-b", managed: true, name: "Rule B", enabled: true },
      ],
    };
    const text = formatRepoJson(data);
    expect(text).toMatch(/\{ "id": "pf-a", "managed": true, "name": "Rule A", "enabled": false \}/);
    expect(text).toMatch(/\{ "id": "pf-b", "managed": true, "name": "Rule B", "enabled": true \}/);
    expect(JSON.parse(text.trimEnd())).toEqual(data);
  });

  it("formatRepoJson compacts page_rules[] to one line per rule", () => {
    const data = {
      schema_version: 1,
      zones: [
        {
          name: "example.com",
          records: [],
          page_rules: [
            {
              id: "force-https",
              priority: 1,
              status: "active",
              target: { operator: "matches", value: "*example.com/*" },
              actions: [{ id: "always_use_https", value: "on" }],
            },
          ],
        },
      ],
    };
    const text = formatRepoJson(data);
    expect(text).toMatch(/\{ "id": "force-https", "priority": 1, "status": "active"/);
    expect(JSON.parse(text.trimEnd())).toEqual(data);
  });

  it("formatRepoJson keeps other string arrays expanded", () => {
    const data = {
      cloudflare: { zone_filter: { mode: "include", names: ["example.invalid", "example.com"] } },
    };
    const text = formatRepoJson(data);
    expect(text).toContain('"example.invalid"');
    expect(text).toContain('"example.com"');
    expect(text).not.toMatch(/\{ "example\.invalid"/);
    expect(JSON.parse(text.trimEnd())).toEqual(data);
  });

  it("formatRepoJson compactArrayKeys [] uses fully expanded objects", () => {
    const data = {
      zones: [{ name: "example.invalid", records: [{ type: "A", name: "@", data: "1.2.3.4", ttl: 1 }] }],
    };
    const text = formatRepoJson(data, { compactArrayKeys: [] });
    expect(text).toContain('"type": "A"');
    expect(text.split("\n").length).toBeGreaterThan(8);
    expect(JSON.parse(text.trimEnd())).toEqual(data);
  });
});
