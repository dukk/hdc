import { describe, expect, it } from "vitest";

import {
  classifyMail,
  extractEmailAddress,
  isAuthenticatedFrom,
  parseMailRaw,
  parseWazuhLevel,
  parseWazuhSourceIp,
} from "../../apps/hdc-agent-server/lib/manager-mailbox.mjs";

describe("manager-mailbox parse", () => {
  it("parses headers and auth", () => {
    const raw =
      "From: Dukk <dukk@dukk.org>\r\n" +
      "Subject: approve 2026-07-14-test\r\n" +
      "Message-ID: <abc@dukk.org>\r\n" +
      "Authentication-Results: mailcow; dkim=pass header.d=dukk.org; spf=pass smtp.mailfrom=dukk.org\r\n" +
      "\r\n" +
      "please approve\r\n";
    const p = parseMailRaw(raw);
    expect(extractEmailAddress(p.from)).toBe("dukk@dukk.org");
    expect(isAuthenticatedFrom(p.authResults, "dukk@dukk.org")).toBe(true);
    expect(isAuthenticatedFrom("", "dukk@dukk.org")).toBe(false);
  });

  it("classifies decision and wazuh", () => {
    expect(classifyMail("approve task-1", "body", "dukk@dukk.org").kind).toBe("decision");
    const w = classifyMail("Wazuh alert level 12", "srcip: 203.0.113.9", "wazuh@hdc.dukk.org");
    expect(w.kind).toBe("wazuh");
    expect(parseWazuhLevel("level 12", "")).toBe(12);
    expect(parseWazuhSourceIp("", "srcip: 203.0.113.9")).toBe("203.0.113.9");
    expect(parseWazuhSourceIp("", "srcip: 10.0.0.5")).toBe(null);
  });

  it("classifies research suggestions", () => {
    const r = classifyMail(
      "Research: macOS on Proxmox",
      "Evaluate https://github.com/jvivs/osx-proxmox",
      "dukk@dukk.org",
    );
    expect(r.kind).toBe("research_suggestion");
    if (r.kind === "research_suggestion") {
      expect(r.title).toBe("macOS on Proxmox");
    }
    expect(classifyMail("Other", "[research] new tool", "dukk@dukk.org").kind).toBe(
      "research_suggestion",
    );
    expect(classifyMail("approve task-1", "HDC Research: foo", "dukk@dukk.org").kind).toBe(
      "research_suggestion",
    );
  });
});
