import { describe, expect, it } from "vitest";
import {
  appriseMailtoUrl,
  buildMailtoUrl,
  composeDir,
  dataDirs,
  hostPort,
  normalizeImageTag,
  normalizeTimezone,
  renderComposeYaml,
  resolveAppriseKeys,
  resolveUpstreamUrl,
  resolveWebUrl,
} from "hdc/clump/services/apprise/lib/apprise-render.mjs";

describe("apprise-render", () => {
  const apprise = {
    image_tag: "latest",
    host_port: 8000,
    public_url: null,
    timezone: "America/New_York",
    worker_count: 1,
    admin: true,
    stateful_mode: "simple",
    mail: { enabled: true },
    keys: [{ id: "ha" }],
  };
  const install = { compose_dir: "/opt/apprise" };
  const relay = {
    host: "postfix-relay.home.example.invalid",
    port: 25,
    from: "noreply@hdc.example.invalid",
  };

  it("normalizes image tag and port defaults", () => {
    expect(normalizeImageTag(apprise)).toBe("latest");
    expect(hostPort(apprise)).toBe(8000);
    expect(hostPort({})).toBe(8000);
    expect(normalizeTimezone(apprise)).toBe("America/New_York");
    expect(composeDir(install)).toBe("/opt/apprise");
  });

  it("renders compose with config/plugin/attach mounts", () => {
    const compose = renderComposeYaml(apprise, install);
    expect(compose).toContain("caronc/apprise:latest");
    expect(compose).toContain('"8000:8000/tcp"');
    expect(compose).toContain("TZ: 'America/New_York'");
    expect(compose).toContain("APPRISE_STATEFUL_MODE: 'simple'");
    expect(compose).toContain("APPRISE_WORKER_COUNT: '1'");
    expect(compose).toContain("APPRISE_ADMIN: 'y'");
    expect(compose).toContain("'/opt/apprise/config:/config'");
    expect(compose).toContain("'/opt/apprise/plugin:/plugin'");
    expect(compose).toContain("'/opt/apprise/attach:/attach'");
  });

  it("resolves data dirs and urls", () => {
    expect(dataDirs(install)).toEqual({
      config: "/opt/apprise/config",
      plugin: "/opt/apprise/plugin",
      attach: "/opt/apprise/attach",
    });
    expect(resolveUpstreamUrl("192.0.2.61", apprise)).toBe("http://192.0.2.61:8000");
    expect(resolveWebUrl(apprise, "192.0.2.61")).toBe("http://192.0.2.61:8000");
  });

  it("builds passwordless mailto URLs for postfix-relay", () => {
    expect(buildMailtoUrl(relay)).toBe(
      "mailto://postfix-relay.home.example.invalid/?from=noreply%40hdc.example.invalid&to=noreply%40hdc.example.invalid",
    );
    expect(appriseMailtoUrl({ mail: { enabled: true, to: "ops@example.invalid" } }, relay)).toBe(
      "mailto://postfix-relay.home.example.invalid/?from=noreply%40hdc.example.invalid&to=ops%40example.invalid",
    );
    expect(appriseMailtoUrl({ mail: { enabled: false } }, relay)).toBeNull();
  });

  it("defaults key ha to the mailto URL", () => {
    const keys = resolveAppriseKeys(apprise, relay);
    expect(keys).toEqual([
      {
        id: "ha",
        urls: [
          "mailto://postfix-relay.home.example.invalid/?from=noreply%40hdc.example.invalid&to=noreply%40hdc.example.invalid",
        ],
      },
    ]);
  });
});
