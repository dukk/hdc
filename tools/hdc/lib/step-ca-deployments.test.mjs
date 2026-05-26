import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  normalizeStepCaConfig,
  resolveStepCaDeployments,
  stepCaGlobalSettings,
} from "../../../packages/services/step-ca/lib/deployments.mjs";

const sampleCfg = {
  schema_version: 2,
  step_ca: {
    ca_name: "HDC Internal CA",
    dns_names: ["ca.hdc.example.invalid"],
    listen_address: ":443",
  },
  defaults: {
    mode: "configure-only",
    configure: { ssh: { user: "root", host: "192.0.2.1" } },
  },
  deployments: [
    {
      system_id: "vm-step-ca-a",
      role: "standalone",
      mode: "configure-only",
      configure: { ssh: { host: "192.0.2.24" } },
    },
  ],
};

describe("step-ca-deployments", () => {
  it("normalizes deployments with standalone role", () => {
    const n = normalizeStepCaConfig(sampleCfg);
    expect(n.deployments).toHaveLength(1);
    expect(n.stepCa.ca_name).toBe("HDC Internal CA");
  });

  it("rejects invalid system_id pattern", () => {
    expect(() =>
      normalizeStepCaConfig({
        step_ca: { dns_names: ["ca.example.com"] },
        deployments: [
          {
            system_id: "vm-step-ca-1",
            role: "standalone",
            configure: { ssh: { host: "192.0.2.1" } },
          },
        ],
      }),
    ).toThrow(/vm-step-ca/);
  });

  it("rejects non-standalone role", () => {
    expect(() =>
      normalizeStepCaConfig({
        step_ca: { dns_names: ["ca.example.com"] },
        deployments: [
          {
            system_id: "vm-step-ca-a",
            role: "primary",
            configure: { ssh: { host: "192.0.2.1" } },
          },
        ],
      }),
    ).toThrow(/standalone/);
  });

  it("requires dns_names in global settings", () => {
    expect(() =>
      stepCaGlobalSettings(
        normalizeStepCaConfig({
          step_ca: {},
          defaults: { mode: "configure-only" },
          deployments: [
            {
              system_id: "vm-step-ca-a",
              role: "standalone",
              mode: "configure-only",
              configure: { ssh: { host: "192.0.2.24" } },
            },
          ],
        }),
      ),
    ).toThrow(/dns_names/);
  });

  it("instanceFlagToSystemId maps letter to vm-step-ca-a", () => {
    expect(instanceFlagToSystemId("a")).toBe("vm-step-ca-a");
  });

  it("resolveStepCaDeployments filters by instance", () => {
    const list = resolveStepCaDeployments(sampleCfg, { instance: "a" });
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("vm-step-ca-a");
  });

  it("stepCaGlobalSettings reads vault key and step path", () => {
    const g = stepCaGlobalSettings(normalizeStepCaConfig(sampleCfg));
    expect(g.passwordVaultKey).toBe("HDC_STEP_CA_PASSWORD");
    expect(g.stepPath).toBe("/etc/step-ca");
    expect(g.enableAcme).toBe(true);
  });
});
