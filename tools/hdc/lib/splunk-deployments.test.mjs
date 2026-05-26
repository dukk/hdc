import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  normalizeSplunkConfig,
  resolveSplunkDeployments,
  splunkGlobalSettings,
} from "../../../packages/services/splunk/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 1,
  splunk: {
    version: "9.4.1",
    build: "abc123def456",
    license: "free",
  },
  defaults: {
    mode: "configure-only",
    role: "standalone",
    configure: { ssh: { user: "root", host: "192.0.2.30" } },
  },
  deployments: [
    {
      system_id: "vm-splunk-a",
      role: "standalone",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.30" } },
    },
  ],
};

describe("splunk-deployments", () => {
  it("normalizes single standalone deployment", () => {
    const n = normalizeSplunkConfig(sampleCfg);
    expect(n.deployments).toHaveLength(1);
    expect(n.splunk.version).toBe("9.4.1");
  });

  it("rejects more than one deployment", () => {
    expect(() =>
      normalizeSplunkConfig({
        ...sampleCfg,
        deployments: [
          sampleCfg.deployments[0],
          { ...sampleCfg.deployments[0], system_id: "vm-splunk-b" },
        ],
      }),
    ).toThrow(/exactly 1/);
  });

  it("rejects non-standalone role", () => {
    expect(() =>
      normalizeSplunkConfig({
        ...sampleCfg,
        deployments: [{ ...sampleCfg.deployments[0], role: "primary" }],
      }),
    ).toThrow(/standalone/);
  });

  it("rejects invalid system_id pattern", () => {
    expect(() =>
      normalizeSplunkConfig({
        deployments: [
          {
            system_id: "vm-splunk-1",
            role: "standalone",
            configure: { ssh: { host: "192.0.2.30" } },
          },
        ],
      }),
    ).toThrow(/vm-splunk/);
  });

  it("instanceFlagToSystemId maps letter to vm-splunk-a", () => {
    expect(instanceFlagToSystemId("a")).toBe("vm-splunk-a");
  });

  it("resolveSplunkDeployments honors --instance", () => {
    const list = resolveSplunkDeployments(sampleCfg, { instance: "a" });
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("vm-splunk-a");
    expect(list[0].role).toBe("standalone");
  });

  it("splunkGlobalSettings requires build", () => {
    expect(() =>
      splunkGlobalSettings({
        splunk: { version: "9.4.1", build: "REPLACE_WITH_BUILD", license: "free" },
        deployments: [],
      }),
    ).toThrow(/build/);
  });
});
