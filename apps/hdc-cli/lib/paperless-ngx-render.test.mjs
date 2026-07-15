import { describe, expect, it } from "vitest";
import {
  formatPaperlessUrl,
  hostPort,
  renderComposeYaml,
  renderDotEnv,
  renderPaperlessEnv,
  tikaEnabled,
} from "hdc/clump/services/paperless-ngx/lib/paperless-ngx-render.mjs";

const baseCfg = {
  image_tag: "latest",
  host_port: 8000,
  timezone: "America/New_York",
  ocr_language: "eng",
  tika_enabled: true,
};

const secrets = {
  secretKey: "test-secret-key-very-long",
  dbPassword: "test-db-password",
};

describe("paperless-ngx render", () => {
  it("tikaEnabled defaults true", () => {
    expect(tikaEnabled({})).toBe(true);
    expect(tikaEnabled({ tika_enabled: false })).toBe(false);
  });

  it("hostPort defaults to 8000", () => {
    expect(hostPort({})).toBe(8000);
    expect(hostPort({ host_port: 9000 })).toBe(9000);
  });

  it("renderComposeYaml includes tika services when enabled", () => {
    const yaml = renderComposeYaml({ tikaEnabled: true });
    expect(yaml).toContain("gotenberg:");
    expect(yaml).toContain("tika:");
    expect(yaml).toContain("PAPERLESS_TIKA_ENABLED: 1");
  });

  it("renderComposeYaml omits tika when disabled", () => {
    const yaml = renderComposeYaml({ tikaEnabled: false });
    expect(yaml).not.toContain("gotenberg:");
    expect(yaml).not.toContain("tika:");
    expect(yaml).not.toContain("PAPERLESS_TIKA_ENABLED");
  });

  it("renderDotEnv includes postgres credentials", () => {
    const env = renderDotEnv(baseCfg, secrets);
    expect(env).toContain("POSTGRES_PASSWORD=test-db-password");
    expect(env).toContain("PAPERLESS_HOST_PORT=8000");
  });

  it("renderPaperlessEnv sets secret key and falls back to CT IP", () => {
    const env = renderPaperlessEnv(baseCfg, secrets, "192.0.2.137");
    expect(env).toContain("PAPERLESS_SECRET_KEY=test-secret-key-very-long");
    expect(env).toContain("PAPERLESS_DBPASS=test-db-password");
    expect(env).toContain("PAPERLESS_URL=http://192.0.2.137:8000");
    expect(env).toContain("PAPERLESS_OCR_LANGUAGE=eng");
  });

  it("renderPaperlessEnv uses public_url when set", () => {
    const env = renderPaperlessEnv(
      { ...baseCfg, public_url: "https://paperless.example.invalid" },
      secrets,
      "192.0.2.137",
    );
    expect(env).toContain("PAPERLESS_URL=https://paperless.example.invalid");
  });

  it("formatPaperlessUrl prefers public_url", () => {
    expect(formatPaperlessUrl({ public_url: "https://paperless.example.invalid" }, "192.0.2.1")).toBe(
      "https://paperless.example.invalid",
    );
    expect(formatPaperlessUrl({}, "192.0.2.137")).toBe("http://192.0.2.137:8000");
  });

  it("admin bootstrap requires password", () => {
    expect(() =>
      renderPaperlessEnv({ ...baseCfg, admin: { enabled: true } }, secrets, "192.0.2.1"),
    ).toThrow(/ADMIN_PASSWORD/);
    const env = renderPaperlessEnv(
      { ...baseCfg, admin: { enabled: true, user: "ops", mail: "ops@example.com" } },
      { ...secrets, adminPassword: "admin-pass" },
      "192.0.2.1",
    );
    expect(env).toContain("PAPERLESS_ADMIN_USER=ops");
    expect(env).toContain("PAPERLESS_ADMIN_PASSWORD=admin-pass");
  });
});
