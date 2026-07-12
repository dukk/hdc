import { describe, expect, it } from "vitest";

import {
  stepCaEndpointList,
  stepCaHttpsBase,
  stepCaReportExtraSections,
} from "../../../clumps/services/step-ca/lib/step-ca-report.mjs";

describe("step-ca-report", () => {
  it("stepCaHttpsBase omits port 443", () => {
    expect(stepCaHttpsBase("ca.home.example.invalid", ":443")).toBe("https://ca.home.example.invalid");
  });

  it("stepCaEndpointList builds health, roots, and ACME URLs", () => {
    const list = stepCaEndpointList({
      dnsNames: ["ca.home.example.invalid"],
      ip: "192.0.2.190",
      listenAddress: ":443",
      enableAcme: true,
    });
    expect(list.map((e) => e.url)).toEqual([
      "https://ca.home.example.invalid/health",
      "https://ca.home.example.invalid/roots.pem",
      "https://ca.home.example.invalid/acme/acme/directory",
      "https://192.0.2.190/health",
    ]);
  });

  it("stepCaReportExtraSections lists endpoints in markdown", () => {
    const text = stepCaReportExtraSections({
      inventory: [
        {
          systemId: "vm-step-ca-a",
          system: null,
          services: [],
          inventoryIp: "192.0.2.190",
          accessNodes: [],
        },
      ],
      stdoutPayload: {
        step_ca: {
          dns_names: ["ca.home.example.invalid"],
          listen_address: ":443",
          enable_acme: true,
          provisioner_name: "admin",
        },
        results: [{ system_id: "vm-step-ca-a", ok: true, host: "192.0.2.190" }],
      },
    }).join("\n");
    expect(text).toContain("## step-ca endpoints");
    expect(text).toContain("https://ca.home.example.invalid/health");
    expect(text).toContain("https://ca.home.example.invalid/acme/acme/directory");
    expect(text).toContain("https://192.0.2.190/health");
    expect(text).toContain("No web admin UI");
  });
});
