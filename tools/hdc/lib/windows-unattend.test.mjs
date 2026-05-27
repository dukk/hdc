import { describe, expect, it } from "vitest";
import {
  assertNoProductKeyInUnattend,
  renderAutounattendXml,
} from "../../../packages/services/windows-desktop/lib/windows-unattend.mjs";

describe("windows-unattend", () => {
  it("renderAutounattendXml includes computer name and omits ProductKey", () => {
    const xml = renderAutounattendXml({
      computerName: "win11-a",
      adminUsername: "Administrator",
      adminPassword: "Secret123!",
      locale: "en-US",
      network: { ipCidr: "10.0.0.50/24", gateway: "10.0.0.1", dnsServers: ["10.0.0.2"] },
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
});
