import { describe, expect, it } from "vitest";
import {
  buildStepCaInitCommand,
  patchCaJsonListenAddress,
  renderSystemdUnit,
  rewriteCaJsonPaths,
} from "../../../clumps/services/step-ca/lib/step-ca-render.mjs";

const global = {
  caName: "HDC Internal CA",
  dnsNames: ["ca.hdc.example.invalid", "ca.hdc.local"],
  listenAddress: ":443",
  deploymentType: "standalone",
  provisionerName: "admin",
  enableAcme: true,
  passwordVaultKey: "HDC_STEP_CA_PASSWORD",
  stepPath: "/etc/step-ca",
};

describe("step-ca-render", () => {
  it("buildStepCaInitCommand includes dns flags and acme", () => {
    const cmd = buildStepCaInitCommand(global, "/tmp/pass.txt");
    expect(cmd).toContain("step ca init");
    expect(cmd).toContain("--dns='ca.hdc.example.invalid'");
    expect(cmd).toContain("--acme");
    expect(cmd).toContain("STEPPATH='/etc/step-ca'");
  });

  it("rewriteCaJsonPaths replaces home step paths", () => {
    const raw = '{"root":"/root/.step/certs/root_ca.crt"}';
    expect(rewriteCaJsonPaths(raw, "/etc/step-ca")).toContain("/etc/step-ca/certs/root_ca.crt");
  });

  it("patchCaJsonListenAddress updates address field", () => {
    const out = patchCaJsonListenAddress('{"address":":8080"}', ":443");
    expect(JSON.parse(out).address).toBe(":443");
  });

  it("renderSystemdUnit references step-ca paths", () => {
    const unit = renderSystemdUnit("/etc/step-ca");
    expect(unit).toContain("User=step");
    expect(unit).toContain("/etc/step-ca/config/ca.json");
    expect(unit).toContain("--password-file=/etc/step-ca/password.txt");
  });
});
