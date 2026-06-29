import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadPackageConfigFromPackageRoot } from "./package-config.mjs";
import {
  createPreprocessContext,
  expandHdcIncludes,
  HDC_INCLUDE_KEY,
  parseJsonc,
  preprocessPackageConfigText,
  readResolvedPackageConfigJson,
  resolveIncludeRelPath,
  stripJsonc,
  stripUtf8Bom,
} from "./json-config-preprocess.mjs";
import { resolveRepoFile } from "./private-repo.mjs";

describe("json-config-preprocess", () => {
  describe("stripJsonc", () => {
    it("removes line comments outside strings", () => {
      const input = `{
  "a": 1, // inline
  // full line
  "b": 2
}`;
      expect(JSON.parse(stripJsonc(input))).toEqual({ a: 1, b: 2 });
    });

    it("removes block comments outside strings", () => {
      const input = `{
  /* block */
  "a": "keep /* not a comment */ ok"
}`;
      expect(JSON.parse(stripJsonc(input))).toEqual({ a: "keep /* not a comment */ ok" });
    });

    it("allows trailing commas", () => {
      const input = `{
  "items": [1, 2,],
  "done": true,
}`;
      expect(JSON.parse(stripJsonc(input))).toEqual({ items: [1, 2], done: true });
    });
  });

  describe("stripUtf8Bom", () => {
    it("removes a leading BOM", () => {
      expect(stripUtf8Bom("\uFEFF{ \"a\": 1 }")).toBe('{ "a": 1 }');
    });

    it("leaves text without BOM unchanged", () => {
      expect(stripUtf8Bom('{ "a": 1 }')).toBe('{ "a": 1 }');
    });
  });

  describe("parseJsonc", () => {
    it("parses commented config", () => {
      const out = parseJsonc(`{ "x": 1 /* y */ }`, "test.json");
      expect(out).toEqual({ x: 1 });
    });

    it("parses BOM-prefixed JSON", () => {
      const out = parseJsonc('\uFEFF{ "a": 1 }', "test.json");
      expect(out).toEqual({ a: 1 });
    });
  });

  describe("resolveIncludeRelPath", () => {
    it("resolves relative to base file directory", () => {
      expect(resolveIncludeRelPath("packages/services/bind/config.json", "zones/a.json")).toBe(
        "packages/services/bind/zones/a.json",
      );
    });

    it("rejects path escape", () => {
      expect(() =>
        resolveIncludeRelPath("packages/services/bind/config.json", "../../../../etc/passwd"),
      ).toThrow(/escapes repo root/);
    });
  });

  describe("expandHdcIncludes", () => {
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

    function ctx(baseRel) {
      return createPreprocessContext({
        publicRoot,
        env: { HDC_PRIVATE_ROOT: privateRoot },
        baseRel,
        visited: new Set(),
      });
    }

    it("splices array includes", () => {
      const rel = "packages/infrastructure/cloudflare/config.json";
      mkdirSync(join(publicRoot, "packages/infrastructure/cloudflare/zones"), { recursive: true });
      writeFileSync(
        join(publicRoot, "packages/infrastructure/cloudflare/zones/a.json"),
        '{"name":"a"}',
        "utf8",
      );
      writeFileSync(
        join(publicRoot, "packages/infrastructure/cloudflare/zones/b.json"),
        '[{"name":"b1"},{"name":"b2"}]',
        "utf8",
      );

      const parsed = {
        zones: [{ [HDC_INCLUDE_KEY]: "zones/a.json" }, { [HDC_INCLUDE_KEY]: "zones/b.json" }],
      };
      const out = expandHdcIncludes(parsed, ctx(rel));
      expect(out).toEqual({
        zones: [{ name: "a" }, { name: "b1" }, { name: "b2" }],
      });
    });

    it("supports nested includes in fragment files", () => {
      const rel = "packages/services/bind/config.json";
      mkdirSync(join(publicRoot, "packages/services/bind/fragments"), { recursive: true });
      writeFileSync(
        join(publicRoot, "packages/services/bind/fragments/records.json"),
        '[{"type":"A","name":"x","data":"1.2.3.4"}]',
        "utf8",
      );
      writeFileSync(
        join(publicRoot, "packages/services/bind/fragments/zone.json"),
        `{
  "id": "example.test",
  "zone_type": "forward",
  "records": [{ "$hdc.include": "records.json" }]
}`,
        "utf8",
      );

      const parsed = {
        zones: [{ [HDC_INCLUDE_KEY]: "fragments/zone.json" }],
      };
      const out = expandHdcIncludes(parsed, ctx(rel));
      expect(out).toEqual({
        zones: [
          {
            id: "example.test",
            zone_type: "forward",
            records: [{ type: "A", name: "x", data: "1.2.3.4" }],
          },
        ],
      });
    });

    it("prefers public over private for included files", () => {
      const rel = "packages/services/pi-hole/config.json";
      mkdirSync(join(publicRoot, "packages/services/pi-hole"), { recursive: true });
      mkdirSync(join(privateRoot, "packages/services/pi-hole"), { recursive: true });
      writeFileSync(join(publicRoot, rel), '{"items":[{"$hdc.include":"part.json"}]}', "utf8");
      writeFileSync(
        join(publicRoot, "packages/services/pi-hole/part.json"),
        '{"from":"public"}',
        "utf8",
      );
      writeFileSync(
        join(privateRoot, "packages/services/pi-hole/part.json"),
        '{"from":"private"}',
        "utf8",
      );

      const out = expandHdcIncludes(parseJsonc(readFileSync(join(publicRoot, rel), "utf8")), ctx(rel));
      expect(out).toEqual({ items: [{ from: "public" }] });
    });

    it("errors on circular includes", () => {
      const rel = "packages/services/n8n/config.json";
      mkdirSync(join(publicRoot, "packages/services/n8n"), { recursive: true });
      writeFileSync(
        join(publicRoot, rel),
        `{ "$hdc.include": "loop.json" }`,
        "utf8",
      );
      writeFileSync(
        join(publicRoot, "packages/services/n8n/loop.json"),
        `{ "$hdc.include": "config.json" }`,
        "utf8",
      );

      expect(() =>
        preprocessPackageConfigText(readFileSync(join(publicRoot, rel), "utf8"), ctx(rel)),
      ).toThrow(/circular \$hdc\.include/);
    });

    it("errors when include directive has extra keys", () => {
      expect(() =>
        expandHdcIncludes({ [HDC_INCLUDE_KEY]: "x.json", extra: true }, ctx("config.json")),
      ).toThrow(/must not contain other keys/);
    });

    it("accepts object form with file property", () => {
      const rel = "packages/services/gatus/config.json";
      mkdirSync(join(publicRoot, "packages/services/gatus"), { recursive: true });
      writeFileSync(join(publicRoot, "packages/services/gatus/extra.json"), '{"ok":true}', "utf8");
      writeFileSync(
        join(publicRoot, rel),
        `{ "$hdc.include": { "file": "extra.json" } }`,
        "utf8",
      );

      const out = preprocessPackageConfigText(readFileSync(join(publicRoot, rel), "utf8"), ctx(rel));
      expect(out).toEqual({ ok: true });
    });

    it("loads BOM-prefixed include sidecars", () => {
      const rel = "packages/services/uptime-kuma/config.json";
      mkdirSync(join(publicRoot, "packages/services/uptime-kuma/monitors-public"), {
        recursive: true,
      });
      writeFileSync(
        join(publicRoot, "packages/services/uptime-kuma/monitors-public/immich.json"),
        '\uFEFF{ "id": "immich", "name": "Immich" }',
        "utf8",
      );
      writeFileSync(
        join(publicRoot, rel),
        '{ "monitors": [{ "$hdc.include": "monitors-public/immich.json" }] }',
        "utf8",
      );

      const out = preprocessPackageConfigText(readFileSync(join(publicRoot, rel), "utf8"), ctx(rel));
      expect(out).toEqual({
        monitors: [{ id: "immich", name: "Immich" }],
      });
    });
  });

  describe("readResolvedPackageConfigJson integration", () => {
    /** @type {string} */
    let publicRoot;
    /** @type {string} */
    let packageRoot;

    beforeEach(() => {
      publicRoot = mkdtempSync(join(tmpdir(), "hdc-public-"));
      packageRoot = join(publicRoot, "packages/infrastructure/cloudflare");
      mkdirSync(join(packageRoot, "zones"), { recursive: true });
    });

    afterEach(() => {
      rmSync(publicRoot, { recursive: true, force: true });
    });

    it("loads via loadPackageConfigFromPackageRoot with comments and includes", () => {
      writeFileSync(
        join(packageRoot, "zones/example.com.json"),
        '{"name":"example.com","records":[]}',
        "utf8",
      );
      writeFileSync(
        join(packageRoot, "config.json"),
        `{
  "schema_version": 1,
  // managed zones
  "zones": [
    { "$hdc.include": "zones/example.com.json" },
  ],
}`,
        "utf8",
      );

      const { data } = loadPackageConfigFromPackageRoot(packageRoot, { publicRoot });
      expect(data.schema_version).toBe(1);
      expect(data.zones).toEqual([{ name: "example.com", records: [] }]);
    });

    it("readResolvedPackageConfigJson honors preprocess:false", () => {
      writeFileSync(join(packageRoot, "config.json"), '{"a":1}', "utf8");
      const resolved = resolveRepoFile(publicRoot, "packages/infrastructure/cloudflare/config.json");
      expect(readResolvedPackageConfigJson(resolved, { preprocess: false })).toEqual({ a: 1 });
    });

    it("readResolvedPackageConfigJson strips BOM when preprocess:false", () => {
      writeFileSync(join(packageRoot, "config.json"), '\uFEFF{"a":1}', "utf8");
      const resolved = resolveRepoFile(publicRoot, "packages/infrastructure/cloudflare/config.json");
      expect(readResolvedPackageConfigJson(resolved, { preprocess: false })).toEqual({ a: 1 });
    });
  });
});
