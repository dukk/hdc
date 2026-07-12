import { describe, expect, it } from "vitest";
import {
  composeDir,
  dataDir,
  hostPort,
  normalizeApiImage,
  normalizeFrontendImage,
  renderComposeYaml,
  renderEnvFile,
  resolveCorsOrigin,
  resolveUpstreamUrl,
  resolveWebUrl,
  trustProxyFlag,
} from "../../../clumps/services/rackula/lib/rackula-render.mjs";

describe("rackula-render", () => {
  const rackula = {
    frontend_image: "ghcr.io/rackulalives/rackula:persist",
    api_image: "ghcr.io/rackulalives/rackula-api:latest",
    host_port: 8080,
    public_url: null,
    api_write_token_enabled: false,
  };
  const install = { compose_dir: "/opt/rackula" };

  it("normalizes images and port defaults", () => {
    expect(normalizeFrontendImage(rackula)).toBe("ghcr.io/rackulalives/rackula:persist");
    expect(normalizeApiImage(rackula)).toBe("ghcr.io/rackulalives/rackula-api:latest");
    expect(normalizeFrontendImage({})).toContain("rackulalives/rackula");
    expect(hostPort(rackula)).toBe(8080);
    expect(hostPort({})).toBe(8080);
    expect(composeDir(install)).toBe("/opt/rackula");
    expect(dataDir(install)).toBe("/opt/rackula/data");
  });

  it("renders two-service compose with data volume", () => {
    const compose = renderComposeYaml(rackula);
    expect(compose).toContain("rackula:");
    expect(compose).toContain("rackula-api:");
    expect(compose).toContain("ghcr.io/rackulalives/rackula:persist");
    expect(compose).toContain("ghcr.io/rackulalives/rackula-api:latest");
    expect(compose).toContain("./data:/data");
    expect(compose).toContain("service_healthy");
  });

  it("renders env with LAN CORS and trust proxy off", () => {
    const env = renderEnvFile(rackula, "192.0.2.156");
    expect(env).toContain("RACKULA_PORT=8080");
    expect(env).toContain("CORS_ORIGIN=http://192.0.2.156:8080");
    expect(env).toContain("RACKULA_TRUST_PROXY=0");
    expect(env).not.toContain("RACKULA_API_WRITE_TOKEN=");
    expect(trustProxyFlag(rackula)).toBe("0");
  });

  it("includes write token when enabled", () => {
    const env = renderEnvFile(
      { ...rackula, api_write_token_enabled: true },
      "192.0.2.156",
      "secret-token",
    );
    expect(env).toContain("RACKULA_API_WRITE_TOKEN=secret-token");
  });

  it("resolves urls and cors from public_url", () => {
    const withPublic = { ...rackula, public_url: "https://rack.example.invalid" };
    expect(resolveCorsOrigin(withPublic, "192.0.2.156")).toBe("https://rack.example.invalid");
    expect(trustProxyFlag(withPublic)).toBe("1");
    expect(resolveUpstreamUrl("192.0.2.156", rackula)).toBe("http://192.0.2.156:8080");
    expect(resolveWebUrl(rackula, "192.0.2.156")).toBe("http://192.0.2.156:8080");
    expect(resolveWebUrl(withPublic, "192.0.2.156")).toBe("https://rack.example.invalid");
  });
});
