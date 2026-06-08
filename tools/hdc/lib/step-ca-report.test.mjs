import { describe, expect, it } from "vitest";

import {
  stepCaEndpointList,
  stepCaHttpsBase,
  stepCaReportExtraSections,
} from "../../../packages/services/step-ca/lib/step-ca-report.mjs";

describe("step-ca-report", () => {
  it("stepCaHttpsBase omits port 443", () => {
    expect(stepCaHttpsBase("ca.hdc.dukk.org", ":443")).toBe("https://ca.hdc.dukk.org");
  });

  it("stepCaEndpointList builds health, roots, and ACME URLs", () => {
    const list = stepCaEndpointList({
      dnsNames: ["ca.hdc.dukk.org"],
      ip: "10.0.0.190",
      listenAddress: ":443",
      enableAcme: true,
    });
    expect(list.map((e) => e.url)).toEqual([
      "https://ca.hdc.dukk.org/health",
      "https://ca.hdc.dukk.org/roots.pem",
      "https://ca.hdc.dukk.org/acme/acme/directory",
      "https://10.0.0.190/health",
    ]);
  });

  it("stepCaReportExtraSections lists endpoints in markdown", () => {
    const text = stepCaReportExtraSections({
      inventory: [
        {
          systemId: "vm-step-ca-a",
          system: null,
          services: [],
          inventoryIp: "10.0.0.190",
          accessNodes: [],
        },
      ],
      stdoutPayload: {
        step_ca: {
          dns_names: ["ca.hdc.dukk.org"],
          listen_address: ":443",
          enable_acme: true,
          provisioner_name: "admin",
        },
        results: [{ system_id: "vm-step-ca-a", ok: true, host: "10.0.0.190" }],
      },
    }).join("\n");
    expect(text).toContain("## step-ca endpoints");
    expect(text).toContain("https://ca.hdc.dukk.org/health");
    expect(text).toContain("https://ca.hdc.dukk.org/acme/acme/directory");
    expect(text).toContain("https://10.0.0.190/health");
    expect(text).toContain("No web admin UI");
  });
});
