import { describe, expect, it } from "vitest";
import {
  composeDir,
  hostPort,
  renderComposeYaml,
  renderFullEnv,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "../../../packages/services/affine/lib/affine-render.mjs";

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

  it("compose yaml defines migration postgres redis and affine", () => {
    const yaml = renderComposeYaml();
    expect(yaml).toContain("affine_migration");
    expect(yaml).toContain("affine_postgres");
    expect(yaml).toContain("affine_redis");
    expect(yaml).toContain("affine_server");
    expect(yaml).toContain("ghcr.io/toeverything/affine");
    expect(yaml).toContain("${POSTGRES_IMAGE}");
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
  });

  it("public_url sets https server host", () => {
    const env = renderFullEnv(
      { ...affine, public_url: "https://affine.dukk.org" },
      secrets,
      "/opt/affine",
    );
    expect(env).toContain("AFFINE_SERVER_HTTPS=true");
    expect(env).toContain("AFFINE_SERVER_HOST=affine.dukk.org");
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
    expect(resolveWebUrl(affine, "10.0.0.151")).toBe("http://10.0.0.151:3010");
    expect(resolveUpstreamUrl("10.0.0.151", affine)).toBe("http://10.0.0.151:3010");
    expect(resolveWebUrl({ ...affine, public_url: "https://affine.example.invalid" })).toBe(
      "https://affine.example.invalid",
    );
  });
});
