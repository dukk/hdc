import { describe, expect, it } from "vitest";
import {
  composeDir,
  hostPort,
  normalizeImage,
  renderComposeYaml,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "../../../clumps/services/omni-tools/lib/omni-tools-render.mjs";

describe("omni-tools-render", () => {
  const omniTools = {
    image: "iib0011/omni-tools:latest",
    host_port: 8080,
    public_url: null,
  };
  const install = { compose_dir: "/opt/omni-tools" };

  it("normalizes image and port defaults", () => {
    expect(normalizeImage(omniTools)).toBe("iib0011/omni-tools:latest");
    expect(normalizeImage({})).toBe("iib0011/omni-tools:latest");
    expect(hostPort(omniTools)).toBe(8080);
    expect(hostPort({})).toBe(8080);
    expect(composeDir(install)).toBe("/opt/omni-tools");
  });

  it("renders compose with host port mapped to container 80", () => {
    const compose = renderComposeYaml(omniTools, install);
    expect(compose).toContain("image: iib0011/omni-tools:latest");
    expect(compose).toContain('"8080:80"');
    expect(compose).toContain("container_name: omni-tools");
  });

  it("resolves urls", () => {
    expect(resolveUpstreamUrl("192.0.2.142", omniTools)).toBe("http://192.0.2.142:8080");
    expect(resolveWebUrl(omniTools, "192.0.2.142")).toBe("http://192.0.2.142:8080");
  });
});
