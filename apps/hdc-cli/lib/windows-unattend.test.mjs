import { describe, expect, it } from "vitest";
import {
  assertNoProductKeyInUnattend,
  renderAutounattendCloneXml,
  renderAutounattendXml,
} from "hdc/clump/services/windows-desktop/lib/windows-unattend.mjs";

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

  it("declares the wcm namespace and keeps components at settings level", () => {
    const xml = renderAutounattendXml({
      computerName: "WIN11-BUILD",
      adminUsername: "Administrator",
      adminPassword: "Secret123!",
      locale: "en-US",
      network: { ipCidr: "192.0.2.50/24", gateway: "192.0.2.1", dnsServers: ["192.0.2.2"] },
    });
    expect(xml).toMatch(/<unattend [^>]*xmlns:wcm="http:\/\/schemas.microsoft.com\/WMIConfig\/2002\/State"/);
    expect(xml).toContain('name="Microsoft-Windows-PnpCustomizationsWinPE"');
    expect(xml).not.toContain("<DNSDomain>");
  });

  it("puts accounts in oobeSystem and enables RDP", () => {
    const xml = renderAutounattendCloneXml({
      computerName: "win11-a",
      adminUsername: "Administrator",
      adminPassword: "Secret123!",
      locale: "en-US",
    });
    const specialize = xml.slice(xml.indexOf('pass="specialize"'), xml.indexOf('pass="oobeSystem"'));
    expect(specialize).not.toContain("LocalAccounts");
    expect(specialize).not.toContain("AdministratorPassword");
    expect(specialize).toContain("<fDenyTSConnections>false</fDenyTSConnections>");
    expect(xml).toContain("<AdministratorPassword>");
    expect(xml).toContain("qemu-ga-x86_64.msi");
  });

  it("uses LocalAccounts for non-builtin admin names", () => {
    const xml = renderAutounattendCloneXml({
      computerName: "win11-a",
      adminUsername: "justin",
      adminPassword: "Secret123!",
      locale: "en-US",
    });
    expect(xml).toContain("<Name>justin</Name>");
    expect(xml).not.toContain("<AdministratorPassword>");
  });
});
