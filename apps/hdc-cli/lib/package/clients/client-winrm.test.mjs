import { describe, expect, it } from "vitest";
import { buildWinRmInvokeScript, psQuote } from "./client-winrm.mjs";

describe("client-winrm", () => {
  it("psQuote escapes single quotes", () => {
    expect(psQuote("it's")).toBe("it''s");
  });

  it("buildWinRmInvokeScript includes computer and SSL flags", () => {
    const s = buildWinRmInvokeScript({
      computerName: "192.0.2.5",
      port: 5986,
      useSsl: true,
      skipCaCheck: true,
      username: "admin",
      password: "secret",
      remoteScript: "Get-Date",
    });
    expect(s).toContain("192.0.2.5");
    expect(s).toContain("SkipCACheck");
    expect(s).toContain("$true");
    expect(s).toContain("Get-Date");
  });
});
