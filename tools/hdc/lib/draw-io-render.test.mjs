import { describe, expect, it } from "vitest";
import {
  hostPort,
  normalizePublicUrl,
  publicDnsFromUrl,
  renderComposeYaml,
  renderDrawIoEnv,
  resolveUpstreamUrl,
} from "../../../packages/services/draw-io/lib/draw-io-render.mjs";

describe("draw-io-render", () => {
  const drawIo = {
    image_tag: "26.0.4",
    host_port: 8080,
    public_url: "https://draw.example.invalid",
  };

  it("normalizes public_url", () => {
    expect(normalizePublicUrl(drawIo)).toBe("https://draw.example.invalid");
    expect(publicDnsFromUrl(drawIo)).toBe("draw.example.invalid");
  });

  it("renders env and compose", () => {
    const env = renderDrawIoEnv(drawIo);
    expect(env).toContain("DRAW_IO_IMAGE_TAG=26.0.4");
    expect(env).toContain("DRAW_IO_HOST_PORT=8080");
    expect(env).toContain("PUBLIC_DNS=draw.example.invalid");
    const compose = renderComposeYaml();
    expect(compose).toContain("jgraph/drawio:${DRAW_IO_IMAGE_TAG}");
    expect(compose).toContain("apparmor:unconfined");
  });

  it("resolves upstream url", () => {
    expect(hostPort(drawIo)).toBe(8080);
    expect(resolveUpstreamUrl("192.0.2.155", drawIo)).toBe("http://192.0.2.155:8080");
  });
});
