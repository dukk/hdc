import { describe, expect, it } from "vitest";
import {
  applicationHosts,
  applicationProtocol,
  composeDir,
  databaseName,
  hostPort,
  normalizeImageTag,
  railsEnv,
  renderComposeYaml,
  renderDawarichEnv,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "../../../packages/services/dawarich/lib/dawarich-render.mjs";

describe("dawarich-render", () => {
  const dawarich = {
    image_tag: "latest",
    postgis_image_tag: "17-3.5-alpine",
    redis_image_tag: "7.4-alpine",
    host_port: 3000,
    rails_env: "production",
    public_url: "https://dawarich.example.invalid",
    time_zone: "America/Chicago",
  };
  const install = { compose_dir: "/opt/dawarich" };
  const secrets = { secretKeyBase: "a".repeat(64), dbPassword: "test-db-pass" };

  it("normalizes image tags, port, and rails env defaults", () => {
    expect(normalizeImageTag(dawarich)).toBe("latest");
    expect(hostPort(dawarich)).toBe(3000);
    expect(hostPort({})).toBe(3000);
    expect(railsEnv(dawarich)).toBe("production");
    expect(databaseName(dawarich)).toBe("dawarich_production");
    expect(composeDir(install)).toBe("/opt/dawarich");
  });

  it("builds APPLICATION_HOSTS with CT IP and public hostname", () => {
    const hosts = applicationHosts(dawarich, "192.0.2.153");
    expect(hosts).toContain("192.0.2.153");
    expect(hosts).toContain("dawarich.example.invalid");
    expect(hosts).toContain("localhost");
    expect(applicationProtocol(dawarich)).toBe("https");
  });

  it("renders env with production database and protocol", () => {
    const env = renderDawarichEnv(dawarich, secrets, "192.0.2.153");
    expect(env).toContain("RAILS_ENV=production");
    expect(env).toContain("POSTGRES_DB=dawarich_production");
    expect(env).toContain("DATABASE_NAME=dawarich_production");
    expect(env).toContain("APPLICATION_PROTOCOL=https");
    expect(env).toContain("APPLICATION_HOSTS=");
    expect(env).toContain("dawarich.example.invalid");
    expect(env).toContain("192.0.2.153");
    expect(env).toContain("TIME_ZONE=America/Chicago");
    expect(env).toContain("SECRET_KEY_BASE=");
    expect(env).toContain("DATABASE_PASSWORD=");
  });

  it("renders compose with four services and named volumes", () => {
    const compose = renderComposeYaml();
    expect(compose).toContain("dawarich_redis");
    expect(compose).toContain("dawarich_db");
    expect(compose).toContain("dawarich_app");
    expect(compose).toContain("dawarich_sidekiq");
    expect(compose).toContain("freikin/dawarich:${DAWARICH_IMAGE_TAG}");
    expect(compose).toContain("postgis/postgis:${POSTGIS_IMAGE_TAG}");
  });

  it("resolves urls", () => {
    expect(resolveUpstreamUrl("192.0.2.153", dawarich)).toBe("http://192.0.2.153:3000");
    expect(resolveWebUrl(dawarich, "192.0.2.153")).toBe("https://dawarich.example.invalid");
  });
});
