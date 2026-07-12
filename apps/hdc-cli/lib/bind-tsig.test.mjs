import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateBindTsigSecret,
  resolveBindTsigSecret,
  writeBindTsigSecretToConfig,
} from "../../../clumps/services/bind/lib/bind-tsig.mjs";

describe("bind-tsig", () => {
  it("generateBindTsigSecret returns base64 of 32 bytes", () => {
    const s = generateBindTsigSecret();
    expect(s.length).toBeGreaterThan(40);
    expect(Buffer.from(s, "base64").length).toBe(32);
  });

  it("writeBindTsigSecretToConfig persists bind.tsig_secret", () => {
    const dir = mkdtempSync(join(tmpdir(), "bind-tsig-"));
    const path = join(dir, "config.json");
    const cfg = { schema_version: 2, bind: { primary_ip: "192.0.2.2" }, zones: [], deployments: [] };
    writeFileSync(path, JSON.stringify(cfg));
    writeBindTsigSecretToConfig(path, "abc123==");
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.bind.tsig_secret).toBe("abc123==");
    rmSync(dir, { recursive: true, force: true });
  });

  it("writeBindTsigSecretToConfig preserves $hdc.include zones on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "bind-tsig-split-"));
    const zonesDir = join(dir, "zones");
    mkdirSync(zonesDir, { recursive: true });
    writeFileSync(
      join(zonesDir, "example.test.json"),
      JSON.stringify({
        id: "example.test",
        zone_type: "forward",
        records: [{ type: "A", name: "host", data: "192.0.2.1", ttl: 3600 }],
      }),
    );
    const path = join(dir, "config.json");
    writeFileSync(
      path,
      `${JSON.stringify({
        schema_version: 2,
        zones: [{ "$hdc.include": "zones/example.test.json" }],
        bind: {},
        deployments: [{ system_id: "vm-bind-a", role: "primary" }],
      })}\n`,
    );
    writeBindTsigSecretToConfig(path, "split-layout-secret==");
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.bind.tsig_secret).toBe("split-layout-secret==");
    expect(written.zones).toEqual([{ "$hdc.include": "zones/example.test.json" }]);
    expect(written.zones[0].id).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("resolveBindTsigSecret", () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let cfgPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bind-tsig-resolve-"));
    cfgPath = join(dir, "config.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * @param {Record<string, string>} [secrets]
   */
  function makeVault(secrets = {}) {
    const store = { ...secrets };
    return {
      unlock: vi.fn(async () => "pass"),
      readSecrets: vi.fn(async () => ({ ...store })),
      setSecret: vi.fn(async (key, value) => {
        store[key] = value;
      }),
    };
  }

  const global = { tsigVaultKey: "HDC_BIND_TSIG_KEY" };

  it("uses bind.tsig_secret from config without generating", async () => {
    const cfg = {
      schema_version: 2,
      bind: { tsig_secret: "from-config==" },
      zones: [],
      deployments: [],
    };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const vault = makeVault();
    const log = vi.fn();
    const secret = await resolveBindTsigSecret({
      cfgPath,
      cfg,
      global,
      vault,
      log,
    });
    expect(secret).toBe("from-config==");
    expect(vault.setSecret).toHaveBeenCalledWith("HDC_BIND_TSIG_KEY", "from-config==");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("config.json"));
  });

  it("generates and writes config when missing everywhere", async () => {
    const cfg = { schema_version: 2, bind: {}, zones: [], deployments: [] };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const vault = makeVault();
    const log = vi.fn();
    const secret = await resolveBindTsigSecret({ cfgPath, cfg, global, vault, log });
    expect(Buffer.from(secret, "base64").length).toBe(32);
    const written = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(written.bind.tsig_secret).toBe(secret);
    expect(vault.setSecret).toHaveBeenCalledWith("HDC_BIND_TSIG_KEY", secret);
  });

  it("regenerate replaces config and vault", async () => {
    const cfg = {
      schema_version: 2,
      bind: { tsig_secret: "old-secret==" },
      zones: [],
      deployments: [],
    };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const vault = makeVault({ HDC_BIND_TSIG_KEY: "old-secret==" });
    const secret = await resolveBindTsigSecret({
      cfgPath,
      cfg,
      global,
      vault,
      regenerate: true,
      log: () => {},
    });
    expect(secret).not.toBe("old-secret==");
    expect(JSON.parse(readFileSync(cfgPath, "utf8")).bind.tsig_secret).toBe(secret);
  });
});
