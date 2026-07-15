import { describe, expect, it } from "vitest";
import {
  adminPasswordVaultKey,
  composeDir,
  enableLogin,
  hostPort,
  memoryLimitMb,
  normalizeImage,
  normalizeLangs,
  renderComposeYaml,
  renderStirlingPdfEnv,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "hdc/clump/services/stirling-pdf/lib/stirling-pdf-render.mjs";

describe("stirling-pdf-render", () => {
  const stirlingPdf = {
    image: "stirlingtools/stirling-pdf:latest",
    host_port: 8080,
    memory_limit_mb: 2048,
    public_url: null,
    timezone: "America/New_York",
    langs: "en_US",
    security: {
      enable_login: true,
      initial_username: "admin",
      admin_password_vault_key: "HDC_STIRLING_PDF_ADMIN_PASSWORD",
    },
  };
  const install = { compose_dir: "/opt/stirling-pdf" };

  it("normalizes image, port, memory, and vault key", () => {
    expect(normalizeImage(stirlingPdf)).toBe("stirlingtools/stirling-pdf:latest");
    expect(normalizeImage({})).toBe("stirlingtools/stirling-pdf:latest");
    expect(hostPort(stirlingPdf)).toBe(8080);
    expect(hostPort({})).toBe(8080);
    expect(memoryLimitMb(stirlingPdf)).toBe(2048);
    expect(memoryLimitMb({})).toBe(2048);
    expect(normalizeLangs(stirlingPdf)).toBe("en_US");
    expect(enableLogin(stirlingPdf)).toBe(true);
    expect(adminPasswordVaultKey(stirlingPdf)).toBe("HDC_STIRLING_PDF_ADMIN_PASSWORD");
    expect(composeDir(install)).toBe("/opt/stirling-pdf");
  });

  it("renders compose with volume mounts and port 8080", () => {
    const compose = renderComposeYaml(stirlingPdf);
    expect(compose).toContain("image: ${STIRLING_PDF_IMAGE}");
    expect(compose).toContain('"${STIRLING_PDF_HOST_PORT}:8080/tcp"');
    expect(compose).toContain("./configs:/configs");
    expect(compose).toContain("./tessdata:/usr/share/tessdata");
    expect(compose).toContain("./logs:/logs");
    expect(compose).toContain("./pipeline:/pipeline");
    expect(compose).toContain("container_name: stirling-pdf");
    expect(compose).toContain("memory: ${STIRLING_PDF_MEMORY_LIMIT}");
  });

  it("renders env with security login vars", () => {
    const env = renderStirlingPdfEnv(stirlingPdf, "test-pass");
    expect(env).toContain("STIRLING_PDF_IMAGE=stirlingtools/stirling-pdf:latest");
    expect(env).toContain("STIRLING_PDF_HOST_PORT=8080");
    expect(env).toContain("DOCKER_ENABLE_SECURITY=true");
    expect(env).toContain("SECURITY_ENABLELOGIN=true");
    expect(env).toContain("SECURITY_INITIALLOGIN_USERNAME=admin");
    expect(env).toContain("SECURITY_INITIALLOGIN_PASSWORD=test-pass");
    expect(env).toContain("LANGS=en_US");
  });

  it("escapes dollar signs in admin password for compose env", () => {
    const env = renderStirlingPdfEnv(stirlingPdf, "pa$$word");
    expect(env).toContain("SECURITY_INITIALLOGIN_PASSWORD=pa$$$$word");
  });

  it("resolves urls", () => {
    expect(resolveUpstreamUrl("192.0.2.139", stirlingPdf)).toBe("http://192.0.2.139:8080");
    expect(resolveWebUrl(stirlingPdf, "192.0.2.139")).toBe("http://192.0.2.139:8080");
  });
});
