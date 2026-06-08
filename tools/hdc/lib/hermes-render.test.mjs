import { describe, expect, it } from "vitest";
import {
  apiPort,
  dashboardEnabled,
  dashboardPort,
  dashboardUsername,
} from "../../../packages/services/hermes/lib/deployments.mjs";
import {
  composeDir,
  dataDir,
  renderComposeEnvFile,
  renderComposeYaml,
  renderHermesEnv,
  resolveDashboardUrl,
} from "../../../packages/services/hermes/lib/hermes-render.mjs";

describe("hermes-render", () => {
  const hermes = {
    image_tag: "v2026.6.5",
    api_port: 8642,
    dashboard_port: 9119,
    dashboard_enabled: true,
    dashboard_username: "admin",
    searxng_url: "http://10.0.0.135:8080",
  };
  const install = { compose_dir: "/opt/hermes", data_subdir: "data" };
  const secrets = {
    openrouterApiKey: "or-test-key",
    dashboardPassword: "dash-pass",
    dashboardAuthSecret: "auth-secret-hex",
  };

  it("normalizes ports and dashboard defaults", () => {
    expect(apiPort(hermes)).toBe(8642);
    expect(dashboardPort(hermes)).toBe(9119);
    expect(dashboardEnabled(hermes)).toBe(true);
    expect(dashboardUsername(hermes)).toBe("admin");
    expect(composeDir(install)).toBe("/opt/hermes");
    expect(dataDir(install)).toBe("/opt/hermes/data");
  });

  it("renders env with OpenRouter and dashboard basic auth", () => {
    const env = renderHermesEnv(hermes, secrets);
    expect(env).toContain("OPENROUTER_API_KEY=or-test-key");
    expect(env).toContain("HERMES_DASHBOARD=1");
    expect(env).toContain("HERMES_DASHBOARD_BASIC_AUTH_USERNAME=admin");
    expect(env).toContain("HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=dash-pass");
    expect(env).toContain("SEARXNG_URL=http://10.0.0.135:8080");
  });

  it("renders compose with image tag and ports", () => {
    const compose = renderComposeYaml(hermes, install);
    expect(compose).toContain("nousresearch/hermes-agent:");
    expect(compose).toContain('"8642:8642"');
    expect(compose).toContain('"9119:9119"');
    expect(compose).toContain('"/opt/hermes/data:/opt/data"');
    expect(renderComposeEnvFile(hermes)).toBe("HERMES_IMAGE_TAG=v2026.6.5\n");
  });

  it("resolves dashboard url from ct ip", () => {
    expect(resolveDashboardUrl(hermes, "10.0.0.113")).toBe("http://10.0.0.113:9119");
    expect(resolveDashboardUrl({ ...hermes, dashboard_enabled: false }, "10.0.0.113")).toBeNull();
  });
});
