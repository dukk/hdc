import { describe, expect, it } from "vitest";
import {
  composeDir,
  dataDirs,
  hostPort,
  normalizeImageTag,
  normalizeTimezone,
  renderComposeYaml,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "hdc/clump/services/wallos/lib/wallos-render.mjs";

describe("wallos-render", () => {
  const wallos = {
    image_tag: "latest",
    host_port: 8282,
    public_url: null,
    timezone: "America/New_York",
  };
  const install = { compose_dir: "/opt/wallos" };

  it("normalizes image tag and port defaults", () => {
    expect(normalizeImageTag(wallos)).toBe("latest");
    expect(hostPort(wallos)).toBe(8282);
    expect(hostPort({})).toBe(8282);
    expect(normalizeTimezone(wallos)).toBe("America/New_York");
    expect(composeDir(install)).toBe("/opt/wallos");
  });

  it("renders compose with absolute bind mounts", () => {
    const compose = renderComposeYaml(wallos, install);
    expect(compose).toContain("bellamy/wallos:latest");
    expect(compose).toContain('"8282:80/tcp"');
    expect(compose).toContain("TZ: 'America/New_York'");
    expect(compose).toContain("'/opt/wallos/db:/var/www/html/db'");
    expect(compose).toContain("'/opt/wallos/logos:/var/www/html/images/uploads/logos'");
  });

  it("resolves data dirs and urls", () => {
    expect(dataDirs(install)).toEqual({
      db: "/opt/wallos/db",
      logos: "/opt/wallos/logos",
    });
    expect(resolveUpstreamUrl("192.0.2.136", wallos)).toBe("http://192.0.2.136:8282");
    expect(resolveWebUrl(wallos, "192.0.2.136")).toBe("http://192.0.2.136:8282");
  });
});
