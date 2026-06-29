import { describe, expect, it } from "vitest";
import {
  renderHermesConfigYaml,
  resolvePrimaryOllamaBackend,
} from "../../../packages/services/hermes/lib/hermes-config-render.mjs";
import {
  apiPort,
  dashboardEnabled,
  dashboardPort,
  dashboardUsername,
  openrouterFallbackVaultKey,
  openrouterVaultKey,
} from "../../../packages/services/hermes/lib/deployments.mjs";
import {
  composeDir,
  dataDir,
  renderComposeEnvFile,
  renderComposeYaml,
  renderHermesEnv,
  resolveDashboardUrl,
} from "../../../packages/services/hermes/lib/hermes-render.mjs";

describe("hermes-render", () => {
  const hermes = {
    image_tag: "v2026.6.5",
    api_port: 8642,
    dashboard_port: 9119,
    dashboard_enabled: true,
    dashboard_username: "admin",
    searxng_url: "http://192.0.2.135:8080",
    ollama_backends: [
      { id: "ollama-a", url: "http://192.0.2.111:11434", primary: true },
      { id: "ollama-b", url: "http://192.0.2.112:11434" },
    ],
    model: { default: "qwen3.5:cloud", context_length: 64000 },
    fallback_providers: [{ provider: "openrouter", model: "anthropic/claude-sonnet-4" }],
    agent: { api_timeout: 1800 },
    discord: { enabled: true, require_mention: true },
  };
  const install = { compose_dir: "/opt/hermes", data_subdir: "data" };
  const secrets = {
    openrouterApiKey: "or-test-key",
    dashboardPassword: "dash-pass",
    dashboardAuthSecret: "auth-secret-hex",
  };

  it("normalizes ports and dashboard defaults", () => {
    expect(apiPort(hermes)).toBe(8642);
    expect(dashboardPort(hermes)).toBe(9119);
    expect(dashboardEnabled(hermes)).toBe(true);
    expect(dashboardUsername(hermes)).toBe("admin");
    expect(composeDir(install)).toBe("/opt/hermes");
    expect(dataDir(install)).toBe("/opt/hermes/data");
  });

  it("exposes openrouter vault key helpers", () => {
    expect(openrouterVaultKey({})).toBe("HDC_HERMES_OPENROUTER_API_KEY");
    expect(openrouterFallbackVaultKey()).toBe("HDC_OPENROUTER_API_KEY");
  });

  it("renders env with OpenRouter and dashboard basic auth", () => {
    const env = renderHermesEnv(hermes, secrets);
    expect(env).toContain("OPENROUTER_API_KEY=or-test-key");
    expect(env).toContain("HERMES_DASHBOARD=1");
    expect(env).toContain("HERMES_DASHBOARD_BASIC_AUTH_USERNAME=admin");
    expect(env).toContain("HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=dash-pass");
    expect(env).toContain("SEARXNG_URL=http://192.0.2.135:8080");
  });

  it("renders env with discord token from extraEnv", () => {
    const env = renderHermesEnv(hermes, secrets, { DISCORD_BOT_TOKEN: "discord-token-test" });
    expect(env).toContain("DISCORD_BOT_TOKEN=discord-token-test");
  });

  it("renders compose with image tag and ports", () => {
    const compose = renderComposeYaml(hermes, install);
    expect(compose).toContain("nousresearch/hermes-agent:");
    expect(compose).toContain('"8642:8642"');
    expect(compose).toContain('"9119:9119"');
    expect(compose).toContain('"/opt/hermes/data:/opt/data"');
    expect(renderComposeEnvFile(hermes)).toBe("HERMES_IMAGE_TAG=v2026.6.5\n");
  });

  it("resolves dashboard url from guest ip", () => {
    expect(resolveDashboardUrl(hermes, "192.0.2.113")).toBe("http://192.0.2.113:9119");
    expect(resolveDashboardUrl({ ...hermes, dashboard_enabled: false }, "192.0.2.113")).toBeNull();
  });
});

describe("hermes-config-render", () => {
  const hermes = {
    ollama_backends: [
      { id: "ollama-a", url: "http://192.0.2.111:11434", primary: true },
      { id: "ollama-b", url: "http://192.0.2.112:11434" },
    ],
    model: { default: "qwen3.5:cloud", context_length: 64000 },
    fallback_providers: [{ provider: "openrouter", model: "anthropic/claude-sonnet-4" }],
    agent: { api_timeout: 1800 },
    discord: { enabled: true, require_mention: true },
  };

  it("resolves primary ollama backend with /v1 base url", () => {
    const primary = resolvePrimaryOllamaBackend(hermes);
    expect(primary?.id).toBe("ollama-a");
    expect(primary?.base_url).toBe("http://192.0.2.111:11434/v1");
  });

  it("renders config.yaml with model, fallback, agent, and discord", () => {
    const yaml = renderHermesConfigYaml(hermes);
    expect(yaml).toContain("model:");
    expect(yaml).toContain("default: qwen3.5:cloud");
    expect(yaml).toContain("provider: custom");
    expect(yaml).toContain("base_url: http://192.0.2.111:11434/v1");
    expect(yaml).toContain("context_length: 64000");
    expect(yaml).toContain("fallback_providers:");
    expect(yaml).toContain("provider: openrouter");
    expect(yaml).toContain("model: anthropic/claude-sonnet-4");
    expect(yaml).toContain("api_timeout: 1800");
    expect(yaml).toContain("discord:");
    expect(yaml).toContain("require_mention: true");
  });

  it("requires model.default when ollama backends are set", () => {
    expect(() =>
      renderHermesConfigYaml({
        ollama_backends: [{ id: "ollama-a", url: "http://192.0.2.111:11434" }],
      }),
    ).toThrow(/hermes.model.default is required/);
  });
});
