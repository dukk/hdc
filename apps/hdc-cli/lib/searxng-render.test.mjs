import { describe, expect, it } from "vitest";
import {
  composeDir,
  normalizeImageTag,
  patchSettingsYaml,
  renderComposeYaml,
  renderSettingsYaml,
  renderSearxngEnv,
  resolvePublicUrl,
} from "hdc/clump/services/searxng/lib/searxng-render.mjs";

const SAMPLE_UPSTREAM = `general:
  instance_name: "SearXNG"
search:
  safe_search: 0
server:
  port: 8888
  bind_address: "127.0.0.1"
  base_url: false
  limiter: false
valkey:
  url: false
engines:
  - name: google
`;

describe("searxng render", () => {
  it("renderComposeYaml includes core and valkey", () => {
    const yaml = renderComposeYaml();
    expect(yaml).toContain("searxng-core");
    expect(yaml).toContain("docker.io/searxng/searxng");
    expect(yaml).toContain("searxng-valkey");
    expect(yaml).toContain("valkey/valkey:9-alpine");
    expect(yaml).toContain("core-config");
  });

  it("renderSearxngEnv sets version port and secret", () => {
    const env = renderSearxngEnv({ image_tag: "latest", host_port: 8080 }, "abc123secret");
    expect(env).toContain("SEARXNG_VERSION=latest");
    expect(env).toContain("SEARXNG_PORT=8080");
    expect(env).toContain("SEARXNG_SECRET=abc123secret");
  });

  it("renderSettingsYaml fallback includes valkey url", () => {
    const yaml = renderSettingsYaml({
      instance_name: "HDC SearXNG",
      host_port: 8080,
      limiter: false,
    });
    expect(yaml).toContain('instance_name: "HDC SearXNG"');
    expect(yaml).toContain("port: 8080");
    expect(yaml).toContain("limiter: false");
    expect(yaml).toContain("base_url: false");
    expect(yaml).toContain('bind_address: "0.0.0.0"');
    expect(yaml).toContain("url: valkey://valkey:6379/0");
  });

  it("patchSettingsYaml updates upstream defaults", () => {
    const yaml = patchSettingsYaml(SAMPLE_UPSTREAM, {
      instance_name: "HDC SearXNG",
      host_port: 8080,
      public_url: "https://search.example.com",
      limiter: true,
    });
    expect(yaml).toContain('instance_name: "HDC SearXNG"');
    expect(yaml).toContain("port: 8080");
    expect(yaml).toContain('bind_address: "0.0.0.0"');
    expect(yaml).toContain('base_url: "https://search.example.com"');
    expect(yaml).toContain("limiter: true");
    expect(yaml).toContain("url: valkey://valkey:6379/0");
    expect(yaml).toContain("engines:");
  });

  it("normalizeImageTag and composeDir defaults", () => {
    expect(normalizeImageTag({})).toBe("latest");
    expect(normalizeImageTag({ image_tag: "2026.3.25" })).toBe("2026.3.25");
    expect(composeDir({})).toBe("/opt/searxng");
    expect(composeDir({ compose_dir: "/srv/searxng" })).toBe("/srv/searxng");
  });

  it("resolvePublicUrl prefers configured url", () => {
    expect(resolvePublicUrl({ public_url: "http://search.example" }, null)).toBe(
      "http://search.example",
    );
    expect(resolvePublicUrl({ host_port: 8080 }, "192.0.2.50")).toBe("http://192.0.2.50:8080");
  });
});
