import { describe, expect, it } from "vitest";

import {
  defaultBotTokenVaultKey,
  effectiveToDesired,
  liveAppToConfigEntry,
  liveAppToNormalized,
  normalizeDiscordConfig,
  normalizeTagList,
  normalizeUriList,
  resolveEffectiveApplication,
} from "hdc/clump/infrastructure/discord/lib/discord-config.mjs";
import { buildDerivedRedirectUris } from "hdc/clump/infrastructure/discord/lib/derive-redirect-uris.mjs";
import { importRowsToApplications } from "hdc/clump/infrastructure/discord/lib/discord-import.mjs";

describe("discord-config", () => {
  it("defaultBotTokenVaultKey slugifies app id", () => {
    expect(defaultBotTokenVaultKey("hermes")).toBe("HDC_DISCORD_HERMES_BOT_TOKEN");
  });

  it("normalizeDiscordConfig reads applications and defaults", () => {
    const cfg = normalizeDiscordConfig({
      schema_version: 1,
      discord: {},
      defaults: { managed: false },
      applications: [
        {
          id: "hermes",
          managed: true,
          bot_token_vault_key: "HDC_HERMES_DISCORD_BOT_TOKEN",
          description: "test",
          redirect_uris: ["https://example.invalid/cb"],
          tags: ["utility"],
        },
      ],
    });
    expect(cfg.applications).toHaveLength(1);
    expect(cfg.applications[0].managed).toBe(true);
    expect(cfg.applications[0].bot_token_vault_key).toBe("HDC_HERMES_DISCORD_BOT_TOKEN");
    expect(cfg.apiBase).toBe("https://discord.com/api/v10");
  });

  it("normalizeDiscordConfig reads hdc-ops public_key and ops_decisions", () => {
    const cfg = normalizeDiscordConfig({
      schema_version: 1,
      discord: {},
      applications: [
        {
          id: "hdc-ops",
          bot_token_vault_key: "HDC_OPS_DISCORD_BOT_TOKEN",
          public_key: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
          ops_decisions: { channel_id: "123456789012345678" },
          match: { application_id: "987654321098765432" },
        },
      ],
    });
    expect(cfg.applications[0].public_key).toMatch(/^aabb/);
    expect(cfg.applications[0].ops_decisions?.channel_id).toBe("123456789012345678");
    expect(cfg.applications[0].match.application_id).toBe("987654321098765432");
  });

  it("liveAppToNormalized maps Discord API fields", () => {
    const norm = liveAppToNormalized({
      id: "123456789012345678",
      name: "Hermes Agent",
      description: "Home bot",
      redirect_uris: ["https://a.example/cb", "https://a.example/cb"],
      interactions_endpoint_url: "https://a.example/interactions",
      tags: ["ai"],
      bot_public: true,
      bot_require_code_grant: false,
    });
    expect(norm.application_id).toBe("123456789012345678");
    expect(norm.redirect_uris).toEqual(["https://a.example/cb"]);
    expect(norm.interactions_endpoint_url).toBe("https://a.example/interactions");
  });

  it("liveAppToConfigEntry preserves managed and consumer from existing", () => {
    const entry = liveAppToConfigEntry(
      {
        id: "123",
        name: "Hermes Agent",
        description: "x",
        redirect_uris: [],
        bot_public: true,
      },
      {
        id: "hermes",
        managed: true,
        consumer: "hermes-a",
        notes: "keep",
        bot_token_vault_key: "HDC_HERMES_DISCORD_BOT_TOKEN",
      }
    );
    expect(entry.id).toBe("hermes");
    expect(entry.managed).toBe(true);
    expect(entry.consumer).toBe("hermes-a");
    expect(entry.notes).toBe("keep");
  });

  it("resolveEffectiveApplication uses explicit redirect_uris over derive warning path", () => {
    const app = normalizeDiscordConfig({
      schema_version: 1,
      discord: {},
      applications: [
        {
          id: "oauth",
          bot_token_vault_key: "HDC_DISCORD_OAUTH_BOT_TOKEN",
          redirect_uris: ["https://explicit.example/callback"],
        },
      ],
    }).applications[0];
    const effective = resolveEffectiveApplication(app);
    expect(effective.redirect_uris).toEqual(["https://explicit.example/callback"]);
    expect(effectiveToDesired(effective).redirect_uris).toEqual([
      "https://explicit.example/callback",
    ]);
  });

  it("normalizeUriList dedupes and sorts", () => {
    expect(normalizeUriList(["https://b", "https://a", "https://b"])).toEqual([
      "https://a",
      "https://b",
    ]);
  });

  it("normalizeTagList dedupes and sorts", () => {
    expect(normalizeTagList(["beta", "alpha", "beta"])).toEqual(["alpha", "beta"]);
  });
});

describe("discord-import", () => {
  it("importRowsToApplications preserves non-imported config entries", () => {
    const rows = [
      {
        configApp: normalizeDiscordConfig({
          schema_version: 1,
          discord: {},
          applications: [{ id: "hermes", bot_token_vault_key: "HDC_HERMES_DISCORD_BOT_TOKEN" }],
        }).applications[0],
        live: {
          id: "999",
          name: "Hermes Agent",
          description: "live",
          redirect_uris: [],
          bot_public: true,
        },
      },
    ];
    const apps = importRowsToApplications(rows, [
      { id: "other", bot_token_vault_key: "HDC_DISCORD_OTHER_BOT_TOKEN" },
    ]);
    expect(apps.some((a) => a.id === "hermes")).toBe(true);
    expect(apps.some((a) => a.id === "other")).toBe(true);
  });
});

describe("derive-redirect-uris", () => {
  it("buildDerivedRedirectUris builds https callback", () => {
    expect(buildDerivedRedirectUris("app.example.invalid", "/oauth/callback")).toEqual({
      redirect_uris: ["https://app.example.invalid/oauth/callback"],
      hostname: "app.example.invalid",
    });
  });
});
