import { describe, expect, it } from "vitest";
import {
  composeDir,
  hostPort,
  isHttpsEnabled,
  normalizeDefaultDomain,
  normalizeImageTag,
  renderComposeYaml,
  renderShlinkEnv,
  resolveUpstreamUrl,
  resolveWebClientUpstreamUrl,
  resolveWebClientUrl,
  resolveWebUrl,
  webClientConfig,
} from "../../../packages/services/shlink/lib/shlink-render.mjs";

describe("shlink-render", () => {
  const shlink = {
    image_tag: "stable",
    postgres_image_tag: "16-alpine",
    redis_image_tag: "7-alpine",
    host_port: 8080,
    default_domain: "s.example.invalid",
    public_url: "https://s.example.invalid",
    timezone: "America/New_York",
    web_client: {
      enabled: true,
      image_tag: "stable",
      host_port: 8081,
      public_url: "https://shlink.example.invalid",
    },
  };
  const install = { compose_dir: "/opt/shlink" };
  const secrets = {
    dbPassword: "db-secret",
    initialApiKey: "api-key-secret",
    geoliteLicenseKey: "geolite-key",
  };

  it("normalizes image and port defaults", () => {
    expect(normalizeImageTag(shlink)).toBe("stable");
    expect(normalizeImageTag({})).toBe("stable");
    expect(hostPort(shlink)).toBe(8080);
    expect(hostPort({})).toBe(8080);
    expect(normalizeDefaultDomain(shlink)).toBe("s.example.invalid");
    expect(composeDir(install)).toBe("/opt/shlink");
  });

  it("derives IS_HTTPS_ENABLED from public_url", () => {
    expect(isHttpsEnabled(shlink)).toBe(true);
    expect(isHttpsEnabled({ public_url: "http://s.example.invalid" })).toBe(false);
  });

  it("renders env with postgres, redis, and web client settings", () => {
    const env = renderShlinkEnv(shlink, secrets);
    expect(env).toContain("DEFAULT_DOMAIN=s.example.invalid");
    expect(env).toContain("IS_HTTPS_ENABLED=true");
    expect(env).toContain("INITIAL_API_KEY=api-key-secret");
    expect(env).toContain("DB_DRIVER=postgres");
    expect(env).toContain("REDIS_SERVERS=redis:6379");
    expect(env).toContain("SHLINK_SERVER_URL=https://s.example.invalid");
    expect(env).toContain("WEB_CLIENT_ENABLED=true");
    expect(env).toContain("GEOLITE_LICENSE_KEY=geolite-key");
  });

  it("renders compose with shlink, db, redis, and web client", () => {
    const compose = renderComposeYaml(shlink);
    expect(compose).toContain("shlinkio/shlink:${SHLINK_IMAGE_TAG}");
    expect(compose).toContain("postgres:${POSTGRES_IMAGE_TAG}");
    expect(compose).toContain("redis:${REDIS_IMAGE_TAG}");
    expect(compose).toContain("shlinkio/shlink-web-client:${WEB_CLIENT_IMAGE_TAG}");
    expect(compose).toContain('"${SHLINK_HOST_PORT}:8080"');
    expect(compose).toContain('"${WEB_CLIENT_HOST_PORT}:80"');
  });

  it("omits web client when disabled", () => {
    const noClient = { ...shlink, web_client: { enabled: false } };
    const compose = renderComposeYaml(noClient);
    expect(compose).not.toContain("shlink-web-client");
    expect(webClientConfig(noClient).enabled).toBe(false);
  });

  it("resolves urls", () => {
    expect(resolveUpstreamUrl("10.0.0.50", shlink)).toBe("http://10.0.0.50:8080");
    expect(resolveWebUrl(shlink, "10.0.0.50")).toBe("https://s.example.invalid");
    expect(resolveWebClientUrl(shlink, "10.0.0.50")).toBe("https://shlink.example.invalid");
    expect(resolveWebClientUpstreamUrl("10.0.0.50", shlink)).toBe("http://10.0.0.50:8081");
  });
});
