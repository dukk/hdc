import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { affineMailEnvLines } from "hdc/package/app-mail-render.mjs";
import {
  composeDir,
  hostPort,
  renderAffineCopilotConfig,
  renderComposeYaml,
  renderFullEnv,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "hdc/clump/services/affine/lib/affine-render.mjs";
import {
  installMailRelayExampleMock,
  restoreMailRelayExampleMock,
} from "../test/mock-mail-relay-example.mjs";

describe("affine render", () => {
  const affine = {
    revision: "stable",
    host_port: 3010,
    postgres_image: "pgvector/pgvector:pg16",
    redis_image: "redis:7.4-alpine",
    db_username: "affine",
    db_database: "affine",
  };
  const secrets = { dbPassword: "test-db-secret-value" };

  beforeEach(() => {
    installMailRelayExampleMock();
  });

  afterEach(() => {
    restoreMailRelayExampleMock();
  });

  it("compose yaml defines migration postgres redis and affine", () => {
    const yaml = renderComposeYaml();
    expect(yaml).toContain("affine_migration");
    expect(yaml).toContain("affine_postgres");
    expect(yaml).toContain("affine_redis");
    expect(yaml).toContain("affine_server");
    expect(yaml).toContain("ghcr.io/toeverything/affine");
    expect(yaml).toContain("${POSTGRES_IMAGE}");
    expect(yaml).toContain("AFFINE_INDEXER_ENABLED=${AFFINE_INDEXER_ENABLED:-false}");
  });

  it("env includes persistent paths and db credentials", () => {
    const env = renderFullEnv(affine, secrets, "/opt/affine");
    expect(env).toContain("AFFINE_REVISION=stable");
    expect(env).toContain("PORT=3010");
    expect(env).toContain("DB_DATA_LOCATION=/opt/affine/postgres");
    expect(env).toContain("UPLOAD_LOCATION=/opt/affine/storage");
    expect(env).toContain("CONFIG_LOCATION=/opt/affine/config");
    expect(env).toContain("DB_PASSWORD=test-db-secret-value");
    expect(env).toContain("POSTGRES_IMAGE=pgvector/pgvector:pg16");
    expect(env).toContain("REDIS_IMAGE=redis:7.4-alpine");
    expect(env).toContain("AFFINE_INDEXER_ENABLED=false");
  });

  it("indexer_enabled true sets AFFINE_INDEXER_ENABLED", () => {
    const env = renderFullEnv({ ...affine, indexer_enabled: true }, secrets, "/opt/affine");
    expect(env).toContain("AFFINE_INDEXER_ENABLED=true");
  });

  it("public_url sets https server host", () => {
    const env = renderFullEnv(
      { ...affine, public_url: "https://affine.example.invalid" },
      secrets,
      "/opt/affine",
    );
    expect(env).toContain("AFFINE_SERVER_HTTPS=true");
    expect(env).toContain("AFFINE_SERVER_HOST=affine.example.invalid");
  });

  it("hostPort defaults to 3010", () => {
    expect(hostPort({})).toBe(3010);
    expect(hostPort({ host_port: 3020 })).toBe(3020);
  });

  it("composeDir defaults", () => {
    expect(composeDir({})).toBe("/opt/affine");
    expect(composeDir({ compose_dir: "/srv/affine" })).toBe("/srv/affine");
  });

  it("resolve web and upstream urls", () => {
    expect(resolveWebUrl(affine, "192.0.2.151")).toBe("http://192.0.2.151:3010");
    expect(resolveUpstreamUrl("192.0.2.151", affine)).toBe("http://192.0.2.151:3010");
    expect(resolveWebUrl({ ...affine, public_url: "https://affine.example.invalid" })).toBe(
      "https://affine.example.invalid",
    );
  });

  it("affineMailEnvLines returns empty when mail disabled", () => {
    expect(affineMailEnvLines({ mail: { enabled: false } })).toEqual([]);
  });

  it("affineMailEnvLines emits MAILER_* without auth when enabled", () => {
    const lines = affineMailEnvLines({
      mail: { enabled: true, from: "affine@hdc.example.invalid" },
    });
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^MAILER_HOST=/),
        expect.stringMatching(/^MAILER_PORT=/),
        "MAILER_SENDER=affine@hdc.example.invalid",
        "MAILER_IGNORE_TLS=true",
      ]),
    );
    expect(lines.join("\n")).not.toMatch(/MAILER_USER|MAILER_PASSWORD/);
  });

  it("renderFullEnv includes mail lines when mail.enabled", () => {
    const env = renderFullEnv(
      { ...affine, mail: { enabled: true, from: "noreply@hdc.example.invalid" } },
      secrets,
      "/opt/affine",
    );
    expect(env).toContain("MAILER_SENDER=noreply@hdc.example.invalid");
    expect(env).toContain("MAILER_IGNORE_TLS=true");
  });

  it("renderAffineCopilotConfig returns null when disabled", () => {
    expect(renderAffineCopilotConfig(affine, secrets)).toBeNull();
  });

  it("renderAffineCopilotConfig writes openai provider and chat scenario", () => {
    const json = renderAffineCopilotConfig(
      {
        ...affine,
        copilot: {
          enabled: true,
          base_url: "http://192.0.2.116:4000/v1",
          model: "qwen35-cloud",
          old_api_style: true,
        },
      },
      { ...secrets, copilotApiKey: "sk-test-litellm-key" },
    );
    expect(json).toBeTruthy();
    const doc = JSON.parse(/** @type {string} */ (json));
    expect(doc.copilot.enabled).toBe(true);
    expect(doc.copilot["providers.openai"]).toEqual({
      apiKey: "sk-test-litellm-key",
      baseUrl: "http://192.0.2.116:4000/v1",
      oldApiStyle: true,
    });
    expect(doc.copilot.scenarios.override_enabled).toBe(true);
    expect(doc.copilot.scenarios.scenarios.chat).toBe("qwen35-cloud");
  });

  it("renderAffineCopilotConfig throws without api key", () => {
    expect(() =>
      renderAffineCopilotConfig(
        { ...affine, copilot: { enabled: true } },
        secrets,
      ),
    ).toThrow(/HDC_LITELLM_MASTER_KEY/);
  });
});
