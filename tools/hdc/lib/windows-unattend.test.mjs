import { describe, expect, it } from "vitest";
import {
  assertNoProductKeyInUnattend,
  renderAutounattendCloneXml,
  renderAutounattendXml,
} from "../../../packages/services/windows-desktop/lib/windows-unattend.mjs";

describe("windows-unattend", () => {
  it("renderAutounattendXml includes computer name and omits ProductKey", () => {
    const xml = renderAutounattendXml({
      computerName: "win11-a",
      adminUsername: "Administrator",
      adminPassword: "Secret123!",
      locale: "en-US",
      network: { ipCidr: "192.0.2.50/24", gateway: "192.0.2.1", dnsServers: ["192.0.2.2"] },
    });
    expect(xml).toContain("<ComputerName>win11-a</ComputerName>");
    expect(xml).toContain("Administrator");
    expect(xml).not.toMatch(/ProductKey/i);
    assertNoProductKeyInUnattend(xml);
  });

  it("assertNoProductKeyInUnattend rejects ProductKey", () => {
    expect(() => assertNoProductKeyInUnattend("<ProductKey>xxx</ProductKey>")).toThrow(
      /ProductKey/,
    );
  });

  it("renderAutounattendCloneXml is specialize-only", () => {
    const xml = renderAutounattendCloneXml({
      computerName: "win11-a",
      adminUsername: "Administrator",
      adminPassword: "Secret123!",
      locale: "en-US",
      network: { ipCidr: "192.0.2.180/24", gateway: "192.0.2.1", dnsServers: ["192.0.2.2"] },
    });
    expect(xml).toContain("<ComputerName>win11-a</ComputerName>");
    expect(xml).not.toContain("DiskConfiguration");
    expect(xml).not.toContain("ImageInstall");
    assertNoProductKeyInUnattend(xml);
  });
});
