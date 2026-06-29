import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { readResolvedPackageConfigJson } from "./json-config-preprocess.mjs";
import {
  migrateUptimeKumaConfigToSplitLayout,
  usesSplitUptimeKumaLayout,
  writeUptimeKumaConfig,
} from "../../../packages/services/uptime-kuma/lib/uptime-kuma-config-write.mjs";
import { UPTIME_KUMA_COMPACT_ARRAY_KEYS } from "../../../packages/services/uptime-kuma/lib/uptime-kuma-import.mjs";

const CONFIG_REL = "packages/services/uptime-kuma/config.json";

/**
 * @param {string} publicRoot
 */
function makeResolved(publicRoot) {
  return {
    found: true,
    path: join(publicRoot, CONFIG_REL),
    rel: CONFIG_REL,
    source: "private",
  };
}

/**
 * @param {string} publicRoot
 */
function ensurePackageDir(publicRoot) {
  mkdirSync(join(publicRoot, "packages/services/uptime-kuma"), { recursive: true });
}

const sampleMonitorA = {
  id: "pi-hole-a",
  name: "Pi-hole A",
  type: "http",
  url: "http://192.0.2.4/admin",
  group: "Infrastructure",
  tags: ["critical"],
  interval: 60,
  managed: true,
};

const sampleMonitorB = {
  id: "bind-a",
  name: "BIND A",
  type: "ping",
  hostname: "192.0.2.2",
  group: "Infrastructure",
  interval: 60,
  managed: true,
};

const sampleStatusPage = {
  id: "public",
  slug: "public",
  title: "Public",
  managed: true,
  groups: [{ name: "Infrastructure", weight: 1, monitors: [{ id: "pi-hole-a" }] }],
};

describe("uptime-kuma config write", () => {
  it("usesSplitUptimeKumaLayout detects $hdc.include in monitors", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "uk-split-"));
    ensurePackageDir(publicRoot);
    writeFileSync(
      join(publicRoot, CONFIG_REL),
      JSON.stringify({
        monitors: [{ "$hdc.include": "monitors/pi-hole-a.json" }],
        status_pages: [],
      }),
      "utf8",
    );
    expect(usesSplitUptimeKumaLayout(makeResolved(publicRoot))).toBe(true);
  });

  it("usesSplitUptimeKumaLayout returns false for inline arrays", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "uk-flat-"));
    ensurePackageDir(publicRoot);
    writeFileSync(
      join(publicRoot, CONFIG_REL),
      JSON.stringify({ monitors: [sampleMonitorA], status_pages: [] }),
      "utf8",
    );
    expect(usesSplitUptimeKumaLayout(makeResolved(publicRoot))).toBe(false);
  });

  it("migrateUptimeKumaConfigToSplitLayout writes sidecars and include index", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "uk-migrate-"));
    ensurePackageDir(publicRoot);
    const resolved = makeResolved(publicRoot);
    writeFileSync(
      resolved.path,
      JSON.stringify({
        schema_version: 4,
        monitors: [sampleMonitorB, sampleMonitorA],
        status_pages: [sampleStatusPage],
        tags: [],
      }),
      "utf8",
    );

    migrateUptimeKumaConfigToSplitLayout(resolved, {
      compactArrayKeys: UPTIME_KUMA_COMPACT_ARRAY_KEYS,
    });

    const root = JSON.parse(readFileSync(resolved.path, "utf8"));
    expect(root.monitors).toEqual([
      { "$hdc.include": "monitors/bind-a.json" },
      { "$hdc.include": "monitors/pi-hole-a.json" },
    ]);
    expect(root.status_pages).toEqual([{ "$hdc.include": "status_pages/public.json" }]);
    expect(
      JSON.parse(
        readFileSync(join(publicRoot, "packages/services/uptime-kuma/monitors/pi-hole-a.json"), "utf8"),
      ),
    ).toMatchObject(sampleMonitorA);

    const expanded = readResolvedPackageConfigJson(resolved, { publicRoot });
    expect(expanded.monitors).toHaveLength(2);
    expect(expanded.status_pages).toHaveLength(1);
  });

  it("writeUptimeKumaConfig preserves split layout and removes orphan monitor files", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "uk-write-split-"));
    ensurePackageDir(publicRoot);
    const resolved = makeResolved(publicRoot);
    writeFileSync(
      resolved.path,
      JSON.stringify({
        schema_version: 4,
        monitors: [sampleMonitorA, sampleMonitorB],
        status_pages: [sampleStatusPage],
        tags: [],
      }),
      "utf8",
    );
    migrateUptimeKumaConfigToSplitLayout(resolved, {
      compactArrayKeys: UPTIME_KUMA_COMPACT_ARRAY_KEYS,
    });

    writeFileSync(
      join(publicRoot, "packages/services/uptime-kuma/monitors/orphan.json"),
      '{"id":"orphan"}',
      "utf8",
    );

    const { layout } = writeUptimeKumaConfig(
      resolved,
      {
        schema_version: 4,
        monitors: [sampleMonitorA],
        status_pages: [sampleStatusPage],
        tags: [],
      },
      { compactArrayKeys: UPTIME_KUMA_COMPACT_ARRAY_KEYS },
    );

    expect(layout).toBe("split");
    expect(
      existsSync(join(publicRoot, "packages/services/uptime-kuma/monitors/orphan.json")),
    ).toBe(false);
    expect(
      existsSync(join(publicRoot, "packages/services/uptime-kuma/monitors/bind-a.json")),
    ).toBe(false);
    expect(
      JSON.parse(
        readFileSync(join(publicRoot, "packages/services/uptime-kuma/monitors/pi-hole-a.json"), "utf8"),
      ),
    ).toMatchObject(sampleMonitorA);
  });

  it("writeUptimeKumaConfig falls back to flat layout when not split", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "uk-write-flat-"));
    ensurePackageDir(publicRoot);
    const resolved = makeResolved(publicRoot);
    writeFileSync(
      resolved.path,
      JSON.stringify({ schema_version: 4, monitors: [sampleMonitorA], status_pages: [], tags: [] }),
      "utf8",
    );

    const { layout } = writeUptimeKumaConfig(
      resolved,
      {
        schema_version: 4,
        monitors: [sampleMonitorA, sampleMonitorB],
        status_pages: [],
        tags: [],
      },
      { compactArrayKeys: UPTIME_KUMA_COMPACT_ARRAY_KEYS },
    );

    expect(layout).toBe("flat");
    const root = JSON.parse(readFileSync(resolved.path, "utf8"));
    expect(root.monitors).toHaveLength(2);
    expect(root.monitors[0]).toMatchObject({ id: "pi-hole-a" });
    expect(
      existsSync(join(publicRoot, "packages/services/uptime-kuma/monitors/pi-hole-a.json")),
    ).toBe(false);
  });
});
