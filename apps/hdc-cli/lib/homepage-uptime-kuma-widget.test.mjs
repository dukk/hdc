import { describe, expect, it } from "vitest";

import {
  resolveUptimeKumaWidgetInstances,
  resolveUptimeKumaWidgetSlug,
  resolveUptimeKumaWidgetUrl,
  uptimeKumaWidgetEnvSuffix,
} from "hdc/clump/services/homepage/lib/homepage-uptime-kuma-widget.mjs";

const defaults = {
  uptime_kuma: {
    port: 3001,
    public_url: "https://uptime-kuma.hdc.dukk.org",
  },
};

const deployments = [
  {
    system_id: "uptime-kuma-a",
    proxmox: {
      lxc: { ip_config: "192.0.2.105/24,gw=192.0.2.1" },
    },
  },
  {
    system_id: "uptime-kuma-ext-a",
    mode: "oci-vm",
    uptime_kuma: {
      public_url: "https://status-ext.dukk.org",
    },
  },
];

describe("homepage uptime-kuma widget", () => {
  it("uptimeKumaWidgetEnvSuffix maps instance flags to env suffixes", () => {
    expect(uptimeKumaWidgetEnvSuffix("a")).toBe("");
    expect(uptimeKumaWidgetEnvSuffix("ext-a")).toBe("EXT_A");
  });

  it("resolveUptimeKumaWidgetSlug uses default and per-instance overrides", () => {
    expect(resolveUptimeKumaWidgetSlug("a", "hdc", {})).toBe("hdc");
    expect(resolveUptimeKumaWidgetSlug("ext-a", "hdc", { "ext-a": "public-edge" })).toBe("public-edge");
  });

  it("resolveUptimeKumaWidgetUrl prefers public_url over LXC IP", () => {
    expect(resolveUptimeKumaWidgetUrl(defaults, deployments[0])).toBe("https://uptime-kuma.hdc.dukk.org");
    expect(resolveUptimeKumaWidgetUrl(defaults, deployments[1])).toBe("https://status-ext.dukk.org");
  });

  it("resolveUptimeKumaWidgetUrl falls back to proxmox.lxc.ip_config", () => {
    const deploy = {
      system_id: "uptime-kuma-a",
      proxmox: { lxc: { ip_config: "192.0.2.105/24,gw=192.0.2.1" } },
      uptime_kuma: {},
    };
    const bareDefaults = { uptime_kuma: { port: 3001 } };
    expect(resolveUptimeKumaWidgetUrl(bareDefaults, deploy)).toBe("http://192.0.2.105:3001");
  });

  it("resolveUptimeKumaWidgetInstances resolves LAN and OCI deployments", () => {
    const instances = resolveUptimeKumaWidgetInstances(
      defaults,
      deployments,
      ["a", "ext-a"],
      "hdc",
      { "ext-a": "public-edge" },
    );
    expect(instances).toHaveLength(2);
    expect(instances[0]).toMatchObject({
      systemId: "uptime-kuma-a",
      url: "https://uptime-kuma.hdc.dukk.org",
      slug: "hdc",
      envSuffix: "",
    });
    expect(instances[1]).toMatchObject({
      systemId: "uptime-kuma-ext-a",
      url: "https://status-ext.dukk.org",
      slug: "public-edge",
      envSuffix: "EXT_A",
    });
  });
});
