import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatResolvedRepoFileLabel,
  hdcPrivateRoot,
  normalizeRepoRelPath,
  preferredNewFilePath,
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
    expect(normalizeRepoRelPath("packages\\services\\bind\\config.json")).toBe(
      "packages/services/bind/config.json",
    );
  });

  it("hdcPrivateRoot uses HDC_PRIVATE_ROOT when set", () => {
    const env = { HDC_PRIVATE_ROOT: privateRoot };
    expect(hdcPrivateRoot(publicRoot, env)).toBe(privateRoot);
  });

  it("resolveRepoFile prefers public over private", () => {
    const rel = "packages/services/bind/config.json";
    mkdirSync(join(publicRoot, "packages", "services", "bind"), { recursive: true });
    mkdirSync(join(privateRoot, "packages", "services", "bind"), { recursive: true });
    writeFileSync(join(publicRoot, rel), '{"public":true}\n', "utf8");
    writeFileSync(join(privateRoot, rel), '{"private":true}\n', "utf8");

    const env = { HDC_PRIVATE_ROOT: privateRoot };
    const r = resolveRepoFile(publicRoot, rel, env);
    expect(r.source).toBe("public");
    expect(JSON.parse(readResolvedRepoJson(r).public)).toBe(true);
  });

  it("resolveRepoFile falls back to private when public missing", () => {
    const rel = "packages/infrastructure/proxmox/config.json";
    mkdirSync(join(privateRoot, "packages", "infrastructure", "proxmox"), { recursive: true });
    writeFileSync(join(privateRoot, rel), '{"private":true}\n', "utf8");

    const env = { HDC_PRIVATE_ROOT: privateRoot };
    const r = resolveRepoFile(publicRoot, rel, env);
    expect(r.source).toBe("private");
    expect(r.found).toBe(true);
    expect(JSON.parse(readResolvedRepoJson(r).private)).toBe(true);
  });

  it("resolveRepoFile returns missing when neither exists", () => {
    const r = resolveRepoFile(publicRoot, "packages/services/missing/config.json", {
      HDC_PRIVATE_ROOT: privateRoot,
    });
    expect(r.found).toBe(false);
    expect(r.source).toBe("missing");
  });

  it("preferredNewFilePath targets private when available", () => {
    const rel = "packages/services/bind/config.json";
    const env = { HDC_PRIVATE_ROOT: privateRoot };
    expect(preferredNewFilePath(publicRoot, rel, env)).toBe(join(privateRoot, rel));
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
    const rel = "packages/services/bind/config.json";
    const r = resolveRepoFile(publicRoot, rel, { HDC_PRIVATE_ROOT: privateRoot });
    r.found = true;
    r.source = "private";
    r.path = join(privateRoot, rel);
    expect(formatResolvedRepoFileLabel(r, publicRoot)).toContain("hdc-private");
  });
});
