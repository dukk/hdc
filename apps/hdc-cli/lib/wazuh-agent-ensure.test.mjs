import { describe, expect, it } from "vitest";

import {
  finishHalfConfiguredCrowdsecCommand,
  wazuhAgentInstalledCheckCommand,
  wazuhAgentInstallCommand,
} from "./package/wazuh-agent-ensure.mjs";
import {
  crowdsecAgentInstalledCheckCommand,
  crowdsecAgentEnrollCommand,
} from "./package/crowdsec-agent-ensure.mjs";

describe("wazuh/crowdsec package state checks", () => {
  it("treats only install ok installed as present, not dpkg -s ic/rc", () => {
    const cmd = wazuhAgentInstalledCheckCommand();
    expect(cmd).toContain("install ok installed");
    expect(cmd).not.toMatch(/dpkg -s wazuh-agent/);
    expect(wazuhAgentInstallCommand("10.0.0.202", "x", "4.10.3")).toContain(cmd);
  });

  it("finishes a half-configured crowdsec package without starting services", () => {
    const cmd = finishHalfConfiguredCrowdsecCommand();
    expect(cmd).toContain("half-configured");
    expect(cmd).toContain("policy-rc.d");
    expect(cmd).toContain("exit 101");
    expect(cmd).toContain("dpkg --configure crowdsec");
    expect(wazuhAgentInstallCommand("10.0.0.202", "x")).toContain("dpkg --configure crowdsec");
  });

  it("repairs crowdsec iF before enroll and does not treat iF as installed", () => {
    expect(crowdsecAgentInstalledCheckCommand()).toContain("install ok installed");
    expect(crowdsecAgentInstalledCheckCommand()).not.toMatch(/command -v crowdsec/);
    const enroll = crowdsecAgentEnrollCommand("http://10.0.0.201:8080", "x".repeat(32));
    expect(enroll).toContain("dpkg --configure crowdsec");
    expect(enroll).toContain("policy-rc.d");
  });
});
