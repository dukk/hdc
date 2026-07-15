import { describe, expect, it } from "vitest";
import {
  adminTokenVaultKey,
  hostPort,
  escapeDockerComposeEnvValue,
  isArgon2PhcAdminToken,
  normalizeDomain,
  normalizeImageTag,
  renderVaultwardenEnv,
  resolveAdminUrl,
  resolveWebUrl,
} from "hdc/clump/services/vaultwarden/lib/vaultwarden-render.mjs";

const baseVw = {
  domain: "https://vault.example.invalid/",
  image_tag: "1.34.0",
  host_port: 80,
  signups_allowed: false,
  invitations_allowed: false,
  websocket_enabled: true,
};

describe("vaultwarden render", () => {
  it("normalizeDomain requires https and strips trailing slash", () => {
    expect(normalizeDomain(baseVw)).toBe("https://vault.example.invalid");
    expect(() => normalizeDomain({ domain: "http://bad.example" })).toThrow(/https/);
    expect(() => normalizeDomain({})).toThrow(/required/);
  });

  it("isArgon2PhcAdminToken detects PHC strings", () => {
    expect(isArgon2PhcAdminToken("$argon2id$v=19$m=65540,t=3,p=4$salt$hash")).toBe(true);
    expect(isArgon2PhcAdminToken("plain-secret")).toBe(false);
  });

  it("escapeDockerComposeEnvValue doubles dollar signs for compose .env", () => {
    expect(escapeDockerComposeEnvValue("$argon2id$v=19$m=1$p=1$s$h")).toBe(
      "$$argon2id$$v=19$$m=1$$p=1$$s$$h",
    );
  });

  it("renderVaultwardenEnv sets DOMAIN and escapes ADMIN_TOKEN for docker compose", () => {
    const phc = "$argon2id$v=19$m=65540,t=3,p=4$salt$hash";
    const env = renderVaultwardenEnv(baseVw, phc);
    expect(env).toContain("DOMAIN=https://vault.example.invalid");
    expect(env).toContain(`ADMIN_TOKEN=${escapeDockerComposeEnvValue(phc)}`);
    expect(env).toContain("SIGNUPS_ALLOWED=false");
    expect(env).toContain("INVITATIONS_ALLOWED=false");
    expect(env).toContain("WEBSOCKET_ENABLED=true");
    expect(env).toContain("VAULTWARDEN_IMAGE_TAG=1.34.0");
    expect(env).toContain("VAULTWARDEN_HOST_PORT=80");
    expect(env).toContain("ROCKET_PORT=80");
  });

  it("signups and invitations true when configured", () => {
    const env = renderVaultwardenEnv(
      { ...baseVw, signups_allowed: true, invitations_allowed: true },
      "token",
    );
    expect(env).toContain("SIGNUPS_ALLOWED=true");
    expect(env).toContain("INVITATIONS_ALLOWED=true");
  });

  it("hostPort defaults to 80", () => {
    expect(hostPort({})).toBe(80);
    expect(hostPort({ host_port: 8080 })).toBe(8080);
  });

  it("normalizeImageTag defaults to latest", () => {
    expect(normalizeImageTag({})).toBe("latest");
    expect(normalizeImageTag({ image_tag: "1.34.0" })).toBe("1.34.0");
  });

  it("adminTokenVaultKey defaults", () => {
    expect(adminTokenVaultKey({})).toBe("HDC_VAULTWARDEN_ADMIN_TOKEN");
    expect(adminTokenVaultKey({ admin_token_vault_key: "CUSTOM" })).toBe("CUSTOM");
  });

  it("resolveWebUrl and resolveAdminUrl", () => {
    expect(resolveWebUrl(baseVw)).toBe("https://vault.example.invalid");
    expect(resolveAdminUrl(baseVw)).toBe("https://vault.example.invalid/admin");
  });

  it("renderVaultwardenEnv omits SMTP auth for internal postfix-relay", () => {
    const env = renderVaultwardenEnv(
      {
        ...baseVw,
        mail: { enabled: true, to: "ops@example.invalid", from: "noreply@example.invalid" },
      },
      "token",
    );
    expect(env).toContain("SMTP_HOST=");
    expect(env).toContain("SMTP_PORT=");
    expect(env).toContain("SMTP_FROM=noreply@example.invalid");
    expect(env).toContain("SMTP_SECURITY=off");
    expect(env).not.toMatch(/^SMTP_USERNAME=/m);
    expect(env).not.toMatch(/^SMTP_PASSWORD=/m);
  });
});
