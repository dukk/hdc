import { describe, expect, it } from "vitest";
import {
  composeDir,
  hostPort,
  normalizeImage,
  renderComposeYaml,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "../../../clumps/services/it-tools/lib/it-tools-render.mjs";

describe("it-tools-render", () => {
  const itTools = {
    image: "corentinth/it-tools:latest",
    host_port: 8080,
    public_url: null,
  };
  const install = { compose_dir: "/opt/it-tools" };

  it("normalizes image and port defaults", () => {
    expect(normalizeImage(itTools)).toBe("corentinth/it-tools:latest");
    expect(normalizeImage({})).toBe("corentinth/it-tools:latest");
    expect(hostPort(itTools)).toBe(8080);
    expect(hostPort({})).toBe(8080);
    expect(composeDir(install)).toBe("/opt/it-tools");
  });

  it("renders compose with host port mapped to container 80", () => {
    const compose = renderComposeYaml(itTools, install);
    expect(compose).toContain("image: corentinth/it-tools:latest");
    expect(compose).toContain('"8080:80"');
    expect(compose).toContain("container_name: it-tools");
  });

  it("resolves urls", () => {
    expect(resolveUpstreamUrl("192.0.2.141", itTools)).toBe("http://192.0.2.141:8080");
    expect(resolveWebUrl(itTools, "192.0.2.141")).toBe("http://192.0.2.141:8080");
  });
});
