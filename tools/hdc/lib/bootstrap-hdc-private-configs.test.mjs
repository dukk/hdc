import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseBootstrapArgs,
  runBootstrapHdcPrivateConfigs,
} from "./bootstrap-hdc-private-configs.mjs";

describe("bootstrap-hdc-private-configs", () => {
  /** @type {string} */
  let publicRoot;
  /** @type {string} */
  let privateRoot;

  beforeEach(() => {
    publicRoot = mkdtempSync(join(tmpdir(), "hdc-public-"));
    privateRoot = mkdtempSync(join(tmpdir(), "hdc-private-"));
    const pkgDir = join(publicRoot, "packages", "services", "foo");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "config.example.json"),
      '{"schema_version":1,"example":true}\n',
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(publicRoot, { recursive: true, force: true });
    rmSync(privateRoot, { recursive: true, force: true });
  });

  it("parseBootstrapArgs handles flags", () => {
    expect(parseBootstrapArgs(["--dry-run", "--force"])).toEqual({
      dryRun: true,
      force: true,
      privateRoot: null,
    });
    expect(parseBootstrapArgs(["--private-root", "/tmp/p"])).toEqual({
      dryRun: false,
      force: false,
      privateRoot: "/tmp/p",
    });
  });

  it("creates config.json from example on first run", () => {
    const dest = join(privateRoot, "packages", "services", "foo", "config.json");
    expect(existsSync(dest)).toBe(false);

    const summary = runBootstrapHdcPrivateConfigs(publicRoot, {
      privateRoot,
      log: () => {},
    });

    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(existsSync(dest)).toBe(true);
    expect(JSON.parse(readFileSync(dest, "utf8")).example).toBe(true);
  });

  it("skips existing config.json without --force", () => {
    const dest = join(privateRoot, "packages", "services", "foo", "config.json");
    mkdirSync(join(privateRoot, "packages", "services", "foo"), { recursive: true });
    writeFileSync(dest, '{"existing":true}\n', "utf8");

    const summary = runBootstrapHdcPrivateConfigs(publicRoot, {
      privateRoot,
      log: () => {},
    });

    expect(summary.skipped).toBe(1);
    expect(summary.created).toBe(0);
    expect(JSON.parse(readFileSync(dest, "utf8")).existing).toBe(true);
  });

  it("overwrites when force is set", () => {
    const dest = join(privateRoot, "packages", "services", "foo", "config.json");
    mkdirSync(join(privateRoot, "packages", "services", "foo"), { recursive: true });
    writeFileSync(dest, '{"existing":true}\n', "utf8");

    const summary = runBootstrapHdcPrivateConfigs(publicRoot, {
      privateRoot,
      force: true,
      log: () => {},
    });

    expect(summary.overwritten).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(JSON.parse(readFileSync(dest, "utf8")).example).toBe(true);
  });

  it("dry-run does not write files", () => {
    const dest = join(privateRoot, "packages", "services", "foo", "config.json");

    const summary = runBootstrapHdcPrivateConfigs(publicRoot, {
      privateRoot,
      dryRun: true,
      log: () => {},
    });

    expect(summary.wouldCreate).toBe(1);
    expect(existsSync(dest)).toBe(false);
  });
});
