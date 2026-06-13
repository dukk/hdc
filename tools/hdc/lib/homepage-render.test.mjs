import { describe, expect, it } from "vitest";

import {
  proxmoxWidgetTlsInsecure,
  renderComposeYaml,
  renderDockerfile,
  renderHomepageEnv,
} from "../../../packages/services/homepage/lib/homepage-render.mjs";

describe("homepage-render", () => {
  it("renderComposeYaml uses build context and NET_RAW", () => {
    const yaml = renderComposeYaml();
    expect(yaml).toContain("build:");
    expect(yaml).toContain("dockerfile: Dockerfile");
    expect(yaml).toContain("HOMEPAGE_BASE_TAG:");
    expect(yaml).toContain("cap_add:");
    expect(yaml).toContain("NET_RAW");
    expect(yaml).not.toMatch(/^\s+image: ghcr\.io\/gethomepage\/homepage/m);
  });

  it("renderDockerfile installs iputils", () => {
    const dockerfile = renderDockerfile();
    expect(dockerfile).toContain("apk add --no-cache iputils");
    expect(dockerfile).toContain("HOMEPAGE_BASE_TAG");
  });

  it("renderHomepageEnv injects NODE_TLS_REJECT_UNAUTHORIZED when proxmox widget enabled", () => {
    const env = renderHomepageEnv({
      allowed_hosts: ["hdc.dukk.org"],
      image_tag: "latest",
      proxmox_widget: { enabled: true },
    });
    expect(env).toContain("NODE_TLS_REJECT_UNAUTHORIZED=0");
  });

  it("renderHomepageEnv omits TLS bypass when proxmox_widget.tls_insecure is false", () => {
    const env = renderHomepageEnv({
      allowed_hosts: ["hdc.dukk.org"],
      proxmox_widget: { enabled: true, tls_insecure: false },
    });
    expect(env).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED");
  });

  it("proxmoxWidgetTlsInsecure defaults true when widget enabled", () => {
    expect(proxmoxWidgetTlsInsecure({ proxmox_widget: { enabled: true } })).toBe(true);
    expect(proxmoxWidgetTlsInsecure({ proxmox_widget: { enabled: false } })).toBe(false);
    expect(proxmoxWidgetTlsInsecure({ proxmox_widget: { enabled: true, tls_insecure: false } })).toBe(false);
  });
});
