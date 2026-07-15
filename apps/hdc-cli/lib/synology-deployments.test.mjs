import { describe, expect, it } from "vitest";

import {
  instanceFlagToSystemId,
  normalizeSynologyConfig,
  resolveSynologyDeployments,
} from "hdc/clump/infrastructure/synology-nas/lib/deployments.mjs";

const fixture = {
  schema_version: 1,
  defaults: {
    ssh: { user: "admin" },
    maintain: { reboot_wait_seconds: 600 },
  },
  deployments: [
    { instance: "a", system_id: "nas-a", ssh: { host: "192.0.2.9" } },
    { instance: "b", system_id: "nas-b", ssh: { host: "192.0.2.10" } },
  ],
};

describe("normalizeSynologyConfig", () => {
  it("accepts valid fixture", () => {
    const n = normalizeSynologyConfig(fixture);
    expect(n.deployments).toHaveLength(2);
  });

  it("rejects missing host", () => {
    expect(() =>
      normalizeSynologyConfig({
        schema_version: 1,
        deployments: [{ system_id: "nas-a", ssh: {} }],
      }),
    ).toThrow(/ssh.host/);
  });
});

describe("resolveSynologyDeployments", () => {
  it("resolves instance letter a to nas-a", () => {
    const d = resolveSynologyDeployments(fixture, { instance: "a" });
    expect(d).toHaveLength(1);
    expect(d[0].systemId).toBe("nas-a");
    expect(d[0].ssh.host).toBe("192.0.2.9");
    expect(d[0].maintain.dockerEnsure).toBe(true);
    expect(d[0].docker.composeBaseDir).toBe("/volume1/docker");
  });

  it("returns all when no filter", () => {
    expect(resolveSynologyDeployments(fixture, {})).toHaveLength(2);
  });
});

describe("instanceFlagToSystemId", () => {
  it("maps b to nas-b", () => {
    expect(instanceFlagToSystemId(fixture.deployments, "b")).toBe("nas-b");
  });
});
