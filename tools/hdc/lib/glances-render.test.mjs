import { describe, expect, it } from "vitest";
import {
  composeDir,
  glancesOpt,
  hostPort,
  normalizeImage,
  normalizeTimezone,
  renderComposeYaml,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "../../../packages/services/glances/lib/glances-render.mjs";

describe("glances-render", () => {
  const glances = {
    image: "nicolargo/glances:latest-full",
    host_port: 61208,
    browser_mode: false,
    public_url: null,
    timezone: "America/New_York",
  };
  const install = { compose_dir: "/opt/glances" };

  it("normalizes image and port defaults", () => {
    expect(normalizeImage(glances)).toBe("nicolargo/glances:latest-full");
    expect(normalizeImage({})).toBe("nicolargo/glances:latest-full");
    expect(hostPort(glances)).toBe(61208);
    expect(hostPort({})).toBe(61208);
    expect(normalizeTimezone(glances)).toBe("America/New_York");
    expect(composeDir(install)).toBe("/opt/glances");
  });

  it("builds glances web server opt", () => {
    expect(glancesOpt(glances)).toBe("-w");
    expect(glancesOpt({ browser_mode: true })).toBe("-w --browser");
  });

  it("renders compose with web server ports and docker socket", () => {
    const compose = renderComposeYaml(glances, install);
    expect(compose).toContain("image: nicolargo/glances:latest-full");
    expect(compose).toContain('"61208:61208"');
    expect(compose).toContain('"61209:61209"');
    expect(compose).toContain("GLANCES_OPT: '-w'");
    expect(compose).toContain("container_name: glances");
    expect(compose).toContain("/var/run/docker.sock:/var/run/docker.sock:ro");
  });

  it("resolves urls", () => {
    expect(resolveUpstreamUrl("192.0.2.95", glances)).toBe("http://192.0.2.95:61208");
    expect(resolveWebUrl(glances, "192.0.2.95")).toBe("http://192.0.2.95:61208");
    expect(resolveWebUrl({ public_url: "https://glances.home.example.invalid" }, "192.0.2.95")).toBe(
      "https://glances.home.example.invalid",
    );
  });
});
