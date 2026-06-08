import { describe, expect, it } from "vitest";
import {
  adminEnabled,
  adminPasswordVaultKey,
  adminUsername,
  composeDir,
  extraHostsList,
  hostPort,
  normalizeImage,
  renderCloudbeaverEnv,
  renderComposeYaml,
  resolveServerUrl,
  resolveUpstreamUrl,
  resolveWebUrl,
  serverName,
} from "../../../packages/services/cloudbeaver/lib/cloudbeaver-render.mjs";

describe("cloudbeaver-render", () => {
  const cloudbeaver = {
    image: "dbeaver/cloudbeaver:latest",
    host_port: 8978,
    public_url: null,
    admin: {
      enabled: true,
      username: "cbadmin",
      server_name: "HDC CloudBeaver",
      admin_password_vault_key: "HDC_CLOUDBEAVER_ADMIN_PASSWORD",
    },
    extra_hosts: ["host.docker.internal:host-gateway"],
  };
  const install = { compose_dir: "/opt/cloudbeaver" };

  it("normalizes image, port, admin settings, and vault key", () => {
    expect(normalizeImage(cloudbeaver)).toBe("dbeaver/cloudbeaver:latest");
    expect(normalizeImage({})).toBe("dbeaver/cloudbeaver:latest");
    expect(hostPort(cloudbeaver)).toBe(8978);
    expect(hostPort({})).toBe(8978);
    expect(adminEnabled(cloudbeaver)).toBe(true);
    expect(adminUsername(cloudbeaver)).toBe("cbadmin");
    expect(serverName(cloudbeaver)).toBe("HDC CloudBeaver");
    expect(adminPasswordVaultKey(cloudbeaver)).toBe("HDC_CLOUDBEAVER_ADMIN_PASSWORD");
    expect(composeDir(install)).toBe("/opt/cloudbeaver");
    expect(extraHostsList(cloudbeaver)).toEqual(["host.docker.internal:host-gateway"]);
  });

  it("renders compose with workspace volume and extra_hosts", () => {
    const compose = renderComposeYaml(cloudbeaver);
    expect(compose).toContain("image: ${CLOUDBEAVER_IMAGE}");
    expect(compose).toContain('"${CLOUDBEAVER_HOST_PORT}:8978/tcp"');
    expect(compose).toContain("./workspace:/opt/cloudbeaver/workspace");
    expect(compose).toContain("container_name: cloudbeaver");
    expect(compose).toContain('host.docker.internal:host-gateway');
  });

  it("renders env with admin bootstrap and CB_SERVER_URL from CT IP", () => {
    const env = renderCloudbeaverEnv(cloudbeaver, "10.0.0.140", "test-pass");
    expect(env).toContain("CLOUDBEAVER_IMAGE=dbeaver/cloudbeaver:latest");
    expect(env).toContain("CLOUDBEAVER_HOST_PORT=8978");
    expect(env).toContain("CB_SERVER_NAME=HDC CloudBeaver");
    expect(env).toContain("CB_SERVER_URL=http://10.0.0.140:8978/");
    expect(env).toContain("CB_ADMIN_NAME=cbadmin");
    expect(env).toContain("CB_ADMIN_PASSWORD=test-pass");
  });

  it("escapes dollar signs in admin password for compose env", () => {
    const env = renderCloudbeaverEnv(cloudbeaver, "10.0.0.140", "pa$$word");
    expect(env).toContain("CB_ADMIN_PASSWORD=pa$$$$word");
  });

  it("resolves server url and web/upstream urls", () => {
    expect(resolveServerUrl(cloudbeaver, "10.0.0.140")).toBe("http://10.0.0.140:8978/");
    expect(resolveUpstreamUrl("10.0.0.140", cloudbeaver)).toBe("http://10.0.0.140:8978");
    expect(resolveWebUrl(cloudbeaver, "10.0.0.140")).toBe("http://10.0.0.140:8978");
  });
});
