import { describe, expect, it } from "vitest";
import { vikunjaMailEnvLines } from "../../../packages/lib/app-mail-render.mjs";
import {
  formatVikunjaPublicUrl,
  renderComposeYaml,
  renderVikunjaEnv,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "../../../packages/services/vikunja/lib/vikunja-render.mjs";

describe("vikunja render", () => {
  const secrets = { jwtSecret: "jwt-test-secret", dbPassword: "db-test-secret" };

  it("renders env with trailing slash on public URL", () => {
    const env = renderVikunjaEnv(
      { public_url: "https://tasks.example.invalid", host_port: 3456, timezone: "UTC" },
      secrets,
      "192.0.2.50",
    );
    expect(env).toContain("VIKUNJA_SERVICE_PUBLICURL=https://tasks.example.invalid/");
    expect(env).toContain("VIKUNJA_SERVICE_JWTSECRET=jwt-test-secret");
    expect(env).toContain("VIKUNJA_DATABASE_PASSWORD=db-test-secret");
    expect(env).toContain("VIKUNJA_HOST_PORT=3456");
  });

  it("falls back to CT IP public URL when public_url omitted", () => {
    const url = formatVikunjaPublicUrl({ host_port: 3456 }, "192.0.2.10");
    expect(url).toBe("http://192.0.2.10:3456/");
  });

  it("compose yaml defines vikunja and db with healthcheck", () => {
    const yaml = renderComposeYaml();
    expect(yaml).toContain("vikunja/vikunja:");
    expect(yaml).toContain("vikunja-db-data");
    expect(yaml).toContain("service_healthy");
    expect(yaml).toContain("pg_isready");
  });

  it("resolveWebUrl and upstream", () => {
    expect(resolveWebUrl({ public_url: "https://tasks.example.invalid/" }, null)).toBe(
      "https://tasks.example.invalid",
    );
    expect(resolveUpstreamUrl("192.0.2.50", { host_port: 3456 })).toBe("http://192.0.2.50:3456");
  });

  it("vikunjaMailEnvLines returns empty when mail disabled", () => {
    expect(vikunjaMailEnvLines({ mail: { enabled: false } })).toEqual([]);
  });
});
