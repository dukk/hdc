import { describe, expect, it } from "vitest";
import {
  composeDir,
  hostPort,
  normalizeImage,
  normalizeTimezone,
  renderComposeYaml,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "../../../clumps/services/openspeedtest/lib/openspeedtest-render.mjs";

describe("openspeedtest-render", () => {
  const openspeedtest = {
    image: "openspeedtest/latest",
    host_port: 3000,
    public_url: null,
    timezone: "America/New_York",
  };
  const install = { compose_dir: "/opt/openspeedtest" };

  it("normalizes image and port defaults", () => {
    expect(normalizeImage(openspeedtest)).toBe("openspeedtest/latest");
    expect(normalizeImage({})).toBe("openspeedtest/latest");
    expect(hostPort(openspeedtest)).toBe(3000);
    expect(hostPort({})).toBe(3000);
    expect(normalizeTimezone(openspeedtest)).toBe("America/New_York");
    expect(composeDir(install)).toBe("/opt/openspeedtest");
  });

  it("renders compose with host port mapped to container 3000", () => {
    const compose = renderComposeYaml(openspeedtest, install);
    expect(compose).toContain("image: openspeedtest/latest");
    expect(compose).toContain('"3000:3000/tcp"');
    expect(compose).toContain("TZ: 'America/New_York'");
    expect(compose).toContain("container_name: openspeedtest");
  });

  it("resolves urls", () => {
    expect(resolveUpstreamUrl("192.0.2.138", openspeedtest)).toBe("http://192.0.2.138:3000");
    expect(resolveWebUrl(openspeedtest, "192.0.2.138")).toBe("http://192.0.2.138:3000");
  });
});
