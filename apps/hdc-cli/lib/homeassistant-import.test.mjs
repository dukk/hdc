import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  haSidecarSlug,
  uniqueSlugsForIds,
  writeHomeassistantConfig,
} from "hdc/clump/services/homeassistant/lib/ha-config-write.mjs";
import {
  listDomainEntities,
  splitEntityId,
} from "hdc/clump/services/homeassistant/lib/ha-import-collect.mjs";
import {
  redactSecretKeys,
  sanitizeConfigEntry,
  sanitizeHaCoreConfig,
  sanitizeHaYamlConfigBody,
} from "hdc/clump/services/homeassistant/lib/ha-import-sanitize.mjs";
import {
  resolveHaApiBaseUrl,
  resolveHaTokenVaultKey,
  haTokenVaultKeyCandidates,
  DEFAULT_HA_TOKEN_VAULT_KEY,
} from "hdc/clump/services/homeassistant/lib/ha-api-auth.mjs";
import { HDC_INCLUDE_KEY } from "hdc/cli/lib/json-config-preprocess.mjs";

describe("ha-import-sanitize", () => {
  it("redacts geo in core config", () => {
    const out = sanitizeHaCoreConfig({
      version: "2024.1.0",
      latitude: 45.1,
      longitude: 8.2,
      elevation: 100,
      location_name: "Home",
    });
    expect(out?.version).toBe("2024.1.0");
    expect(out?.latitude).toBe("redacted");
    expect(out?.longitude).toBe("redacted");
    expect(out?.elevation).toBe("redacted");
    expect(out?.location_name).toBe("Home");
  });

  it("redacts nested secret keys", () => {
    const out = redactSecretKeys({
      alias: "x",
      password: "secret",
      nested: { api_key: "k", keep: 1 },
    });
    expect(out).toEqual({
      alias: "x",
      password: "",
      nested: { api_key: "", keep: 1 },
    });
  });

  it("sanitizes yaml config bodies", () => {
    expect(sanitizeHaYamlConfigBody({ trigger: [], token: "t" })).toEqual({
      trigger: [],
      token: "",
    });
  });

  it("projects config entry metadata", () => {
    const entry = sanitizeConfigEntry({
      entry_id: "abc",
      domain: "mqtt",
      title: "MQTT",
      state: "loaded",
      source: "user",
      disabled_by: null,
      supports_options: true,
      data: { password: "nope" },
    });
    expect(entry).toMatchObject({
      entry_id: "abc",
      title: "MQTT",
      state: "loaded",
      supports_options: true,
    });
    expect(entry).not.toHaveProperty("data");
    expect(entry).not.toHaveProperty("domain");
  });
});

describe("ha-import-collect helpers", () => {
  it("splits entity ids", () => {
    expect(splitEntityId("automation.doorbell")).toEqual({
      domain: "automation",
      objectId: "doorbell",
    });
    expect(splitEntityId("bad")).toBeNull();
  });

  it("lists domain entities with id from attributes", () => {
    const list = listDomainEntities(
      [
        { entity_id: "automation.a", attributes: { id: "custom-id" } },
        { entity_id: "script.b", attributes: {} },
        { entity_id: "light.x", attributes: {} },
      ],
      "automation",
    );
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("custom-id");
  });
});

describe("ha-api-auth resolve", () => {
  it("defaults token vault key", () => {
    expect(resolveHaTokenVaultKey({})).toBe(DEFAULT_HA_TOKEN_VAULT_KEY);
    expect(
      resolveHaTokenVaultKey({
        homeassistant: { api: { token_vault_key: "HDC_CUSTOM" } },
      }),
    ).toBe("HDC_CUSTOM");
  });

  it("token vault key candidates include homepage fallback", () => {
    expect(haTokenVaultKeyCandidates({})).toEqual([
      DEFAULT_HA_TOKEN_VAULT_KEY,
      "HDC_HOMEPAGE_HA_TOKEN",
    ]);
    expect(
      haTokenVaultKeyCandidates({
        homeassistant: { api: { token_vault_key: "HDC_CUSTOM" } },
      }),
    ).toEqual(["HDC_CUSTOM", DEFAULT_HA_TOKEN_VAULT_KEY, "HDC_HOMEPAGE_HA_TOKEN"]);
  });

  it("prefers public_url then guest ip", () => {
    const deployment = {
      homeassistant: { publicUrl: "https://ha.example.invalid/" },
      proxmox: { qemu: { ip: "192.0.2.30/24" } },
    };
    expect(resolveHaApiBaseUrl(deployment, {})).toBe("https://ha.example.invalid");
    expect(
      resolveHaApiBaseUrl(
        { homeassistant: { publicUrl: "" }, proxmox: { qemu: { ip: "192.0.2.30/24" } } },
        {},
      ),
    ).toBe("http://192.0.2.30:8123");
  });

  it("resolveHaApiAuth uses first non-empty optional vault key", async () => {
    const { resolveHaApiAuth } = await import(
      "hdc/clump/services/homeassistant/lib/ha-api-auth.mjs",
    );
    const vault = {
      async getSecret(key, opts) {
        expect(opts?.optional).toBe(true);
        if (key === "HDC_HOMEPAGE_HA_TOKEN") return "live-token";
        return "";
      },
    };
    const auth = await resolveHaApiAuth({
      cfg: {},
      deployment: {
        homeassistant: { publicUrl: "" },
        proxmox: { qemu: { ip: "192.0.2.30/24" } },
      },
      vault,
    });
    expect(auth.token).toBe("live-token");
    expect(auth.vaultKey).toBe("HDC_HOMEPAGE_HA_TOKEN");
    expect(auth.baseUrl).toBe("http://192.0.2.30:8123");
  });
});

describe("ha-config-write", () => {
  /** @type {string[]} */
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("slugs and uniquifies ids", () => {
    expect(haSidecarSlug("MQTT Broker!")).toBe("mqtt-broker");
    const map = uniqueSlugsForIds(["Foo!", "foo!", "bar"]);
    expect(map.get("Foo!")).toBe("foo");
    expect(map.get("foo!")).toBe("foo-2");
    expect(map.get("bar")).toBe("bar");
  });

  it("writes split sidecars and orphans removed", () => {
    const dir = mkdtempSync(join(tmpdir(), "ha-import-"));
    dirs.push(dir);
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ schema_version: 2, deployments: [] }), "utf8");
    mkdirSync(join(dir, "integrations"), { recursive: true });
    writeFileSync(join(dir, "integrations", "orphan.json"), "{}\n", "utf8");

    /** @type {import("hdc/cli/lib/private-repo.mjs").ResolvedRepoFile} */
    const resolved = {
      found: true,
      path: configPath,
      rel: "clumps/services/homeassistant/config.json",
      source: "test",
      publicPath: null,
      privatePath: configPath,
    };

    writeHomeassistantConfig(
      resolved,
      {
        schema_version: 3,
        deployments: [{ system_id: "vm-homeassistant-a" }],
        integrations: [
          {
            id: "mqtt",
            domain: "mqtt",
            entries: [{ entry_id: "1", title: "MQTT" }],
          },
        ],
        automations: [{ id: "doorbell", entity_id: "automation.doorbell", config: { alias: "x" } }],
        scripts: [],
        scenes: [],
      },
      { split: true },
    );

    const root = JSON.parse(readFileSync(configPath, "utf8"));
    expect(root.integrations).toEqual([
      { [HDC_INCLUDE_KEY]: "integrations/mqtt.json" },
    ]);
    expect(root.automations).toEqual([
      { [HDC_INCLUDE_KEY]: "automations/doorbell.json" },
    ]);
    expect(readdirSync(join(dir, "integrations")).sort()).toEqual(["mqtt.json"]);
    expect(readdirSync(join(dir, "automations"))).toEqual(["doorbell.json"]);
    const mqtt = JSON.parse(readFileSync(join(dir, "integrations", "mqtt.json"), "utf8"));
    expect(mqtt.domain).toBe("mqtt");
    expect(mqtt.entries).toHaveLength(1);
  });
});
