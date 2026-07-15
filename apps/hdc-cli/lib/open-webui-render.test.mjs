import { describe, expect, it } from "vitest";
import {
  hostPort,
  normalizeImageTag,
  normalizeOllamaBackends,
  ollamaBaseUrlsJoined,
  renderOpenWebuiEnv,
  secretKeyVaultKey,
} from "hdc/clump/services/open-webui/lib/open-webui-render.mjs";

describe("open-webui render", () => {
  const backends = [
    { id: "ollama-a", url: "http://192.0.2.25:11434" },
    { id: "ollama-b", url: "http://192.0.2.26:11434" },
  ];

  it("normalizeOllamaBackends requires http(s) urls", () => {
    expect(normalizeOllamaBackends(backends)).toEqual(backends);
    expect(() => normalizeOllamaBackends([{ id: "x", url: "tcp://bad" }])).toThrow(/http/);
    expect(normalizeOllamaBackends([])).toEqual([]);
    expect(normalizeOllamaBackends(undefined)).toEqual([]);
  });

  it("ollamaBaseUrlsJoined uses semicolons", () => {
    expect(ollamaBaseUrlsJoined(backends)).toBe(
      "http://192.0.2.25:11434;http://192.0.2.26:11434",
    );
  });

  it("renderOpenWebuiEnv sets OLLAMA_BASE_URLS and K8S_FLAG", () => {
    const env = renderOpenWebuiEnv(
      { ollama_backends: backends, image_tag: "v0.6.26", host_port: 3000 },
      "test-secret-key",
    );
    expect(env).toContain("OLLAMA_BASE_URL=http://192.0.2.25:11434");
    expect(env).toContain(
      "OLLAMA_BASE_URLS=http://192.0.2.25:11434;http://192.0.2.26:11434",
    );
    expect(env).toContain("WEBUI_SECRET_KEY=test-secret-key");
    expect(env).toContain("K8S_FLAG=false");
    expect(env).toContain("OPEN_WEBUI_IMAGE_TAG=v0.6.26");
    expect(env).toContain("OPEN_WEBUI_HOST_PORT=3000");
    expect(env).toContain("WEBUI_AUTH=true");
  });

  it("WEBUI_AUTH false when webui_auth is false", () => {
    const env = renderOpenWebuiEnv(
      { ollama_backends: backends, webui_auth: false },
      "secret",
    );
    expect(env).toContain("WEBUI_AUTH=false");
  });

  it("hostPort defaults to 3000", () => {
    expect(hostPort({})).toBe(3000);
    expect(hostPort({ host_port: 8080 })).toBe(8080);
  });

  it("normalizeImageTag defaults to main", () => {
    expect(normalizeImageTag({})).toBe("main");
    expect(normalizeImageTag({ image_tag: "v0.6.26" })).toBe("v0.6.26");
  });

  it("secretKeyVaultKey defaults", () => {
    expect(secretKeyVaultKey({})).toBe("HDC_OPEN_WEBUI_SECRET_KEY");
    expect(secretKeyVaultKey({ secret_key_vault_key: "CUSTOM" })).toBe("CUSTOM");
  });
});
