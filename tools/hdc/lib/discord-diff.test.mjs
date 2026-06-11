import { describe, expect, it } from "vitest";

import { effectiveToDesired } from "../../../packages/infrastructure/discord/lib/discord-config.mjs";
import {
  diffApplication,
  patchBodyForDrift,
  uriSetDrift,
} from "../../../packages/infrastructure/discord/lib/discord-diff.mjs";
import { planAppSync } from "../../../packages/infrastructure/discord/lib/discord-sync.mjs";
import { normalizeDiscordConfig } from "../../../packages/infrastructure/discord/lib/discord-config.mjs";

describe("discord-diff", () => {
  it("uriSetDrift reports missing and extra URIs", () => {
    const drift = uriSetDrift(
      ["https://config.example/cb"],
      ["https://live.example/cb", "https://config.example/cb"]
    );
    expect(drift.missing).toEqual([]);
    expect(drift.extra).toEqual(["https://live.example/cb"]);
  });

  it("diffApplication returns no drift when live is unavailable", () => {
    const drift = diffApplication({
      desired: {
        description: "configured",
        redirect_uris: ["https://config.example/cb"],
        interactions_endpoint_url: null,
        tags: [],
        bot_public: true,
        bot_require_code_grant: false,
      },
      live: null,
    });
    expect(drift.has_drift).toBe(false);
  });

  it("diffApplication detects description and redirect drift", () => {
    const drift = diffApplication({
      desired: {
        description: "configured",
        redirect_uris: ["https://config.example/cb"],
        interactions_endpoint_url: null,
        tags: [],
        bot_public: true,
        bot_require_code_grant: false,
      },
      live: {
        description: "live",
        redirect_uris: ["https://config.example/cb", "https://extra.example/cb"],
        interactions_endpoint_url: null,
        tags: [],
        bot_public: true,
        bot_require_code_grant: false,
      },
    });
    expect(drift.has_drift).toBe(true);
    expect(drift.description_mismatch).toBe(true);
    expect(drift.redirect_uris.extra).toEqual(["https://extra.example/cb"]);
  });

  it("patchBodyForDrift merges redirect URIs without dropping extras", () => {
    const desired = {
      description: "configured",
      redirect_uris: ["https://config.example/cb", "https://new.example/cb"],
      interactions_endpoint_url: null,
      tags: [],
      bot_public: true,
      bot_require_code_grant: false,
    };
    const live = {
      application_id: "1",
      name: "App",
      description: "live",
      redirect_uris: ["https://extra.example/cb"],
      interactions_endpoint_url: null,
      tags: [],
      bot_public: true,
      bot_require_code_grant: false,
    };
    const drift = diffApplication({ desired, live });
    const patch = patchBodyForDrift({ drift, desired, live });
    expect(patch.description).toBe("configured");
    expect(patch.redirect_uris).toEqual([
      "https://config.example/cb",
      "https://extra.example/cb",
      "https://new.example/cb",
    ]);
  });
});

describe("discord-sync", () => {
  it("planAppSync skips unmanaged applications", () => {
    const config = normalizeDiscordConfig({
      schema_version: 1,
      discord: {},
      applications: [{ id: "hermes", managed: false, bot_token_vault_key: "HDC_HERMES_DISCORD_BOT_TOKEN" }],
    });
    const plan = planAppSync({
      configApp: config.applications[0],
      live: {
        application_id: "1",
        name: "Hermes",
        description: "",
        redirect_uris: [],
        interactions_endpoint_url: null,
        tags: [],
        bot_public: true,
        bot_require_code_grant: false,
      },
    });
    expect(plan.action).toBe("skip");
  });

  it("planAppSync plans update when managed app drifts", () => {
    const config = normalizeDiscordConfig({
      schema_version: 1,
      discord: {},
      applications: [
        {
          id: "hermes",
          managed: true,
          bot_token_vault_key: "HDC_HERMES_DISCORD_BOT_TOKEN",
          description: "desired description",
        },
      ],
    });
    const app = config.applications[0];
    const effective = effectiveToDesired({
      id: app.id,
      display_name: app.display_name,
      description: app.description,
      redirect_uris: app.redirect_uris,
      interactions_endpoint_url: app.interactions_endpoint_url,
      tags: app.tags,
      bot_public: app.bot_public,
      bot_require_code_grant: app.bot_require_code_grant,
      derived: null,
    });
    const plan = planAppSync({
      configApp: app,
      live: {
        application_id: "1",
        name: "Hermes",
        description: "live description",
        redirect_uris: [],
        interactions_endpoint_url: null,
        tags: [],
        bot_public: true,
        bot_require_code_grant: false,
      },
    });
    expect(plan.action).toBe("update");
    expect(plan.patch?.description).toBe(app.description);
    expect(effective.description).toBe("desired description");
  });
});
