import { describe, expect, it } from "vitest";
import {
  encryptionKeyVaultKey,
  hostPort,
  normalizeImageTag,
  normalizeTimezone,
  parsePublicUrl,
  renderComposeYaml,
  renderN8nEnv,
  resolveN8nUrlSettings,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "../../../packages/services/n8n/lib/n8n-render.mjs";

const baseN8n = {
  image_tag: "1.0.0",
  host_port: 5678,
  public_url: "https://n8n.example.invalid/",
  timezone: "America/Chicago",
};

describe("n8n render", () => {
  it("parsePublicUrl accepts https and strips path", () => {
    const u = parsePublicUrl(baseN8n);
    expect(u?.origin).toBe("https://n8n.example.invalid");
  });

  it("renderN8nEnv sets encryption key and webhook URL from public_url", () => {
    const env = renderN8nEnv(baseN8n, "test-encryption-key", "10.0.0.50");
    expect(env).toContain("N8N_ENCRYPTION_KEY=test-encryption-key");
    expect(env).toContain("N8N_HOST=n8n.example.invalid");
    expect(env).toContain("N8N_PROTOCOL=https");
    expect(env).toContain("WEBHOOK_URL=https://n8n.example.invalid/");
    expect(env).toContain("N8N_IMAGE_TAG=1.0.0");
    expect(env).toContain("N8N_HOST_PORT=5678");
    expect(env).toContain("TZ=America/Chicago");
    expect(env).toContain("N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true");
  });

  it("renderN8nEnv uses CT IP when public_url omitted", () => {
    const env = renderN8nEnv({ host_port: 5678 }, "key", "10.0.0.99");
    expect(env).toContain("N8N_HOST=10.0.0.99");
    expect(env).toContain("N8N_PROTOCOL=http");
    expect(env).toContain("WEBHOOK_URL=http://10.0.0.99:5678/");
  });

  it("hostPort defaults to 5678", () => {
    expect(hostPort({})).toBe(5678);
    expect(hostPort({ host_port: 8080 })).toBe(8080);
  });

  it("normalizeImageTag defaults to latest", () => {
    expect(normalizeImageTag({})).toBe("latest");
    expect(normalizeImageTag({ image_tag: "1.0.0" })).toBe("1.0.0");
  });

  it("normalizeTimezone defaults", () => {
    expect(normalizeTimezone({})).toBe("America/New_York");
    expect(normalizeTimezone({ timezone: "UTC" })).toBe("UTC");
  });

  it("encryptionKeyVaultKey defaults", () => {
    expect(encryptionKeyVaultKey({})).toBe("HDC_N8N_ENCRYPTION_KEY");
    expect(encryptionKeyVaultKey({ encryption_key_vault_key: "CUSTOM" })).toBe("CUSTOM");
  });

  it("renderComposeYaml includes image and volume", () => {
    const yaml = renderComposeYaml();
    expect(yaml).toContain("docker.n8n.io/n8nio/n8n");
    expect(yaml).toContain("n8n_data:");
  });

  it("resolveWebUrl and resolveUpstreamUrl", () => {
    expect(resolveWebUrl(baseN8n, "10.0.0.1")).toBe("https://n8n.example.invalid");
    expect(resolveUpstreamUrl("10.0.0.1", baseN8n)).toBe("http://10.0.0.1:5678");
    expect(resolveN8nUrlSettings({ host_port: 5678 }, "10.0.0.2").webhookUrl).toBe(
      "http://10.0.0.2:5678/",
    );
  });
});
