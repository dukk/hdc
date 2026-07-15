import { describe, expect, it } from "vitest";
import {
  dbPasswordVaultKey,
  jwtSecretVaultKey,
  listenPort,
  normalizePublicUrl,
  renderPostizEnv,
  resolveBaseUrl,
  resolveAccessUrl,
} from "hdc/clump/services/postiz/lib/postiz-render.mjs";

describe("postiz render", () => {
  it("normalizePublicUrl strips trailing slash", () => {
    expect(normalizePublicUrl("https://postiz.example.invalid/")).toBe(
      "https://postiz.example.invalid",
    );
    expect(normalizePublicUrl(null)).toBeNull();
  });

  it("resolveBaseUrl prefers configured public_url", () => {
    expect(resolveBaseUrl({ public_url: "https://postiz.example.invalid" }, "192.0.2.50")).toBe(
      "https://postiz.example.invalid",
    );
    expect(resolveBaseUrl({}, "192.0.2.50")).toBe("http://192.0.2.50");
  });

  it("renderPostizEnv sets required keys and NOT_SECURED for http", () => {
    const env = renderPostizEnv({}, "dbpass", "jwtsecret", "http://192.0.2.50");
    expect(env).toContain("DATABASE_URL=postgresql://postiz:dbpass@localhost:5432/postiz");
    expect(env).toContain("JWT_SECRET=jwtsecret");
    expect(env).toContain("FRONTEND_URL=http://192.0.2.50");
    expect(env).toContain("NEXT_PUBLIC_BACKEND_URL=http://192.0.2.50/api");
    expect(env).toContain("NOT_SECURED=true");
    expect(env).toContain("STORAGE_PROVIDER=local");
  });

  it("renderPostizEnv includes env_extra", () => {
    const env = renderPostizEnv(
      { env_extra: { X_API_KEY: "abc", DISABLE_REGISTRATION: "false" } },
      "db",
      "jwt",
      "https://postiz.example.invalid",
    );
    expect(env).toContain("X_API_KEY=abc");
    expect(env).toContain("NOT_SECURED=false");
  });

  it("listenPort defaults to 80", () => {
    expect(listenPort({})).toBe(80);
    expect(listenPort({ listen_port: 8080 })).toBe(8080);
  });

  it("vault key helpers", () => {
    expect(dbPasswordVaultKey({})).toBe("HDC_POSTIZ_DB_PASSWORD");
    expect(jwtSecretVaultKey({})).toBe("HDC_POSTIZ_JWT_SECRET");
  });

  it("resolveAccessUrl uses public_url when set", () => {
    expect(resolveAccessUrl({ public_url: "https://postiz.example.invalid" }, "192.0.2.50")).toBe(
      "https://postiz.example.invalid",
    );
    expect(resolveAccessUrl({}, "192.0.2.50")).toBe("http://192.0.2.50");
  });
});
