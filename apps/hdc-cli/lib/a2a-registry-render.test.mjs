import { describe, expect, it } from "vitest";
import {
  composeDir,
  hostPort,
  imageTag,
  normalizeLogLevel,
  normalizePypiVersion,
  renderComposeYaml,
  renderDockerfile,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "hdc/clump/services/a2a-registry/lib/a2a-registry-render.mjs";

describe("a2a-registry-render", () => {
  const a2aRegistry = {
    pypi_version: "0.1.5",
    host_port: 8000,
    public_url: null,
    log_level: "INFO",
  };
  const install = { compose_dir: "/opt/a2a-registry" };

  it("normalizes version, port, and log level defaults", () => {
    expect(normalizePypiVersion(a2aRegistry)).toBe("0.1.5");
    expect(normalizePypiVersion({})).toBe("0.1.5");
    expect(hostPort(a2aRegistry)).toBe(8000);
    expect(hostPort({})).toBe(8000);
    expect(normalizeLogLevel(a2aRegistry)).toBe("INFO");
    expect(normalizeLogLevel({ log_level: "debug" })).toBe("DEBUG");
    expect(composeDir(install)).toBe("/opt/a2a-registry");
    expect(composeDir({})).toBe("/opt/a2a-registry");
    expect(imageTag(a2aRegistry)).toBe("hdc/a2a-registry:0.1.5");
  });

  it("renders Dockerfile with pinned PyPI version", () => {
    const dockerfile = renderDockerfile(a2aRegistry);
    expect(dockerfile).toContain("FROM python:3.12-slim");
    expect(dockerfile).toContain("ARG A2A_REGISTRY_VERSION=0.1.5");
    expect(dockerfile).toContain('a2a-registry==${A2A_REGISTRY_VERSION}');
    expect(dockerfile).toContain('CMD ["a2a-registry", "serve"');
  });

  it("renders compose with build args and host port mapping", () => {
    const compose = renderComposeYaml(a2aRegistry, install);
    expect(compose).toContain("hdc/a2a-registry:0.1.5");
    expect(compose).toContain('A2A_REGISTRY_VERSION: "0.1.5"');
    expect(compose).toContain('"8000:8000"');
    expect(compose).toContain("--log-level");
    expect(compose).toContain("INFO");
  });

  it("resolves urls", () => {
    expect(resolveUpstreamUrl("192.0.2.141", a2aRegistry)).toBe("http://192.0.2.141:8000");
    expect(resolveWebUrl(a2aRegistry, "192.0.2.141")).toBe("http://192.0.2.141:8000");
    expect(
      resolveWebUrl({ ...a2aRegistry, public_url: "https://registry.example.invalid/" }, "192.0.2.141"),
    ).toBe("https://registry.example.invalid");
  });

  it("rejects invalid pypi_version", () => {
    expect(() => normalizePypiVersion({ pypi_version: "0.1.5; rm -rf /" })).toThrow(
      /pypi_version is invalid/,
    );
  });
});
