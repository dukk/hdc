import { describe, expect, it } from "vitest";
import {
  authEnabled,
  composeDir,
  escapeDockerComposeEnvValue,
  hostPort,
  normalizeImage,
  normalizeImageTag,
  renderComposeYaml,
  renderWaddleViewControllerEnv,
  resolveImageRef,
  resolveUpstreamUrl,
  resolveWebUrl,
  sessionSecretVaultKey,
} from "hdc/clump/services/waddle-view-controller/lib/waddle-view-controller-render.mjs";

describe("waddle-view-controller-render", () => {
  const waddle = {
    image: "ghcr.io/dukk/waddle-view-controller",
    image_tag: "latest",
    host_port: 8443,
    public_url: null,
    auth_enabled: true,
    session_secret_vault_key: "HDC_WADDLE_VIEW_CONTROLLER_SESSION_SECRET",
  };
  const install = { compose_dir: "/opt/waddle-view-controller" };

  it("normalizes image, tag, port, auth, and vault key", () => {
    expect(normalizeImage(waddle)).toBe("ghcr.io/dukk/waddle-view-controller");
    expect(normalizeImage({})).toBe("ghcr.io/dukk/waddle-view-controller");
    expect(normalizeImageTag(waddle)).toBe("latest");
    expect(normalizeImageTag({})).toBe("latest");
    expect(resolveImageRef(waddle)).toBe("ghcr.io/dukk/waddle-view-controller:latest");
    expect(resolveImageRef({ image: "ghcr.io/dukk/waddle-view-controller:v1.2.3" })).toBe(
      "ghcr.io/dukk/waddle-view-controller:v1.2.3",
    );
    expect(hostPort(waddle)).toBe(8443);
    expect(hostPort({})).toBe(8443);
    expect(authEnabled(waddle)).toBe(true);
    expect(authEnabled({ auth_enabled: false })).toBe(false);
    expect(sessionSecretVaultKey(waddle)).toBe("HDC_WADDLE_VIEW_CONTROLLER_SESSION_SECRET");
    expect(composeDir(install)).toBe("/opt/waddle-view-controller");
  });

  it("renders compose with HTTPS port map and data volume", () => {
    const compose = renderComposeYaml(waddle);
    expect(compose).toContain("image: ${WADDLE_VIEW_CONTROLLER_IMAGE}");
    expect(compose).toContain('"${WADDLE_VIEW_CONTROLLER_HOST_PORT}:443/tcp"');
    expect(compose).toContain("./data:/var/lib/waddle-controller");
    expect(compose).toContain("container_name: waddle-view-controller");
    expect(compose).toContain("env_file:");
  });

  it("renders env with auth and session secret", () => {
    const env = renderWaddleViewControllerEnv(waddle, "test-secret");
    expect(env).toContain("WADDLE_VIEW_CONTROLLER_IMAGE=ghcr.io/dukk/waddle-view-controller:latest");
    expect(env).toContain("WADDLE_VIEW_CONTROLLER_HOST_PORT=8443");
    expect(env).toContain("WADDLE_CONTROLLER_AUTH_ENABLED=1");
    expect(env).toContain("WADDLE_CONTROLLER_SESSION_SECRET=test-secret");
  });

  it("omits session secret when auth disabled", () => {
    const env = renderWaddleViewControllerEnv({ ...waddle, auth_enabled: false }, "unused");
    expect(env).toContain("WADDLE_CONTROLLER_AUTH_ENABLED=0");
    expect(env).not.toContain("WADDLE_CONTROLLER_SESSION_SECRET");
  });

  it("escapes dollar signs in session secret for compose env", () => {
    expect(escapeDockerComposeEnvValue("pa$$word")).toBe("pa$$$$word");
    const env = renderWaddleViewControllerEnv(waddle, "pa$$word");
    expect(env).toContain("WADDLE_CONTROLLER_SESSION_SECRET=pa$$$$word");
  });

  it("resolves https urls", () => {
    expect(resolveUpstreamUrl("192.0.2.200", waddle)).toBe("https://192.0.2.200:8443");
    expect(resolveWebUrl(waddle, "192.0.2.200")).toBe("https://192.0.2.200:8443");
    expect(
      resolveWebUrl({ ...waddle, public_url: "https://waddle.example.invalid" }, "192.0.2.200"),
    ).toBe("https://waddle.example.invalid");
  });
});
