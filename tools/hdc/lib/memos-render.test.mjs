import { describe, expect, it } from "vitest";
import {
  composeDir,
  dataDir,
  hostPort,
  normalizeDriver,
  normalizeImageTag,
  renderComposeYaml,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "../../../packages/services/memos/lib/memos-render.mjs";

describe("memos-render", () => {
  const memos = {
    image_tag: "stable",
    host_port: 5230,
    driver: "sqlite",
    public_url: null,
  };
  const install = { compose_dir: "/opt/memos" };

  it("normalizes image tag, port, and driver defaults", () => {
    expect(normalizeImageTag(memos)).toBe("stable");
    expect(hostPort(memos)).toBe(5230);
    expect(hostPort({})).toBe(5230);
    expect(normalizeDriver(memos)).toBe("sqlite");
    expect(composeDir(install)).toBe("/opt/memos");
  });

  it("renders compose with absolute bind mounts", () => {
    const compose = renderComposeYaml(memos, install);
    expect(compose).toContain("neosmemo/memos:stable");
    expect(compose).toContain('"5230:5230"');
    expect(compose).toContain("MEMOS_PORT: 5230");
    expect(compose).toContain("MEMOS_DRIVER: sqlite");
    expect(compose).toContain("'/opt/memos/data:/var/opt/memos'");
    expect(compose).not.toContain("MEMOS_INSTANCE_URL");
  });

  it("includes MEMOS_INSTANCE_URL when public_url is set", () => {
    const withUrl = { ...memos, public_url: "https://memos.example.com" };
    const compose = renderComposeYaml(withUrl, install);
    expect(compose).toContain("MEMOS_INSTANCE_URL: 'https://memos.example.com'");
  });

  it("resolves data dir and urls", () => {
    expect(dataDir(install)).toBe("/opt/memos/data");
    expect(resolveUpstreamUrl("192.0.2.151", memos)).toBe("http://192.0.2.151:5230");
    expect(resolveWebUrl(memos, "192.0.2.151")).toBe("http://192.0.2.151:5230");
  });
});
