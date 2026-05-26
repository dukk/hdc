import { describe, expect, it } from "vitest";
import {
  composeFileUrl,
  normalizeAioBlock,
  renderComposeYaml,
  resolveAioInterfaceUrl,
} from "../../../packages/services/nextcloud/lib/nextcloud-render.mjs";

describe("nextcloud render", () => {
  it("composeFileUrl points at official AIO compose", () => {
    expect(composeFileUrl("latest")).toContain("nextcloud/all-in-one/main/compose.yaml");
    expect(composeFileUrl("beta")).toContain("nextcloud/all-in-one/main/compose.yaml");
  });

  it("renders standalone ports and latest image", () => {
    const yaml = renderComposeYaml({
      aio: { image_channel: "latest", interface_host_port: 8080, reverse_proxy: { enabled: false } },
    });
    expect(yaml).toContain("ghcr.io/nextcloud-releases/all-in-one:latest");
    expect(yaml).toContain("nextcloud-aio-mastercontainer");
    expect(yaml).toContain("nextcloud_aio_mastercontainer");
    expect(yaml).toContain('"80:80"');
    expect(yaml).toContain('"8080:8080"');
    expect(yaml).toContain('"8443:8443"');
    expect(yaml).not.toContain("APACHE_PORT");
  });

  it("renders reverse-proxy mode without 80/8443 and with APACHE env", () => {
    const yaml = renderComposeYaml({
      aio: {
        image_channel: "beta",
        interface_host_port: 8081,
        reverse_proxy: { enabled: true, apache_port: 11000 },
      },
    });
    expect(yaml).toContain("all-in-one:beta");
    expect(yaml).toContain('"8081:8080"');
    expect(yaml).not.toContain('"80:80"');
    expect(yaml).not.toContain("8443:8443");
    expect(yaml).toContain("APACHE_PORT: 11000");
    expect(yaml).toContain("APACHE_IP_BINDING: 127.0.0.1");
  });

  it("normalizeAioBlock and resolveAioInterfaceUrl", () => {
    const aio = normalizeAioBlock({
      aio: { image_channel: "beta", interface_host_port: 9090, reverse_proxy: { enabled: true } },
    });
    expect(aio.imageTag).toBe("beta");
    expect(aio.interfaceHostPort).toBe(9090);
    expect(aio.reverseProxyEnabled).toBe(true);
    expect(resolveAioInterfaceUrl("192.0.2.50", { aio: { interface_host_port: 8080 } })).toBe(
      "https://192.0.2.50:8080",
    );
  });
});
