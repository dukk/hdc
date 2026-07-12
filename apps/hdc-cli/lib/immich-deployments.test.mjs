import { describe, expect, it } from "vitest";

import { normalizeImmichConfig, instanceFlagToSystemId } from "../../../clumps/services/immich/lib/deployments.mjs";
import { renderImmichEnv } from "../../../clumps/services/immich/lib/immich-render.mjs";

describe("normalizeImmichConfig synology-docker", () => {
  it("accepts immich-a with synology.instance", () => {
    const cfg = {
      schema_version: 2,
      defaults: {
        mode: "synology-docker",
        synology: { instance: "a", stack_id: "immich" },
        immich: { public_url: "https://immich.example.invalid" },
        install: { compose_dir: "/volume1/docker/immich" },
      },
      deployments: [{ system_id: "immich-a" }],
    };
    const norm = normalizeImmichConfig(cfg);
    expect(norm.deployments[0].system_id).toBe("immich-a");
    expect(norm.deployments[0].mode).toBe("synology-docker");
  });

  it("rejects synology-docker without synology.instance", () => {
    const cfg = {
      schema_version: 2,
      deployments: [{ system_id: "immich-a", mode: "synology-docker" }],
    };
    expect(() => normalizeImmichConfig(cfg)).toThrow(/synology\.instance/);
  });

  it("rejects wrong system_id for synology-docker", () => {
    const cfg = {
      schema_version: 2,
      deployments: [
        {
          system_id: "vm-immich-a",
          mode: "synology-docker",
          synology: { instance: "a" },
        },
      ],
    };
    expect(() => normalizeImmichConfig(cfg)).toThrow(/immich-<letter>/);
  });
});

describe("normalizeImmichConfig proxmox-qemu", () => {
  it("requires configure.ssh.host for proxmox-qemu", () => {
    const cfg = {
      schema_version: 2,
      deployments: [
        {
          system_id: "vm-immich-a",
          mode: "proxmox-qemu",
          proxmox: { host_id: "hypervisor-a", qemu: { vmid: 1 } },
        },
      ],
    };
    expect(() => normalizeImmichConfig(cfg)).toThrow(/configure\.ssh\.host/);
  });
});

describe("instanceFlagToSystemId", () => {
  it("maps letter instance to immich-a", () => {
    expect(instanceFlagToSystemId("a")).toBe("immich-a");
  });

  it("preserves vm-immich-a", () => {
    expect(instanceFlagToSystemId("vm-immich-a")).toBe("vm-immich-a");
  });
});

describe("renderImmichEnv", () => {
  it("includes IMMICH_SERVER_URL when public_url is set", () => {
    const env = renderImmichEnv(
      { public_url: "https://immich.example.invalid", timezone: "UTC" },
      { compose_dir: "/volume1/docker/immich" },
      "secret",
    );
    expect(env).toContain("IMMICH_SERVER_URL=https://immich.example.invalid");
    expect(env).toContain("DB_PASSWORD=secret");
  });

  it("omits IMMICH_SERVER_URL when public_url is null", () => {
    const env = renderImmichEnv(
      { public_url: null, timezone: "UTC" },
      { compose_dir: "/opt/immich" },
      "secret",
    );
    expect(env).not.toContain("IMMICH_SERVER_URL=");
  });
});
