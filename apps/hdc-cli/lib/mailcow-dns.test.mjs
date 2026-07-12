import { describe, expect, it } from "vitest";

import {
  buildAllDnsChecklists,
  buildDnsChecklist,
  dkimOwnerName,
  formatDnsChecklistMarkdown,
} from "../../../clumps/services/mailcow/lib/mailcow-dns.mjs";

describe("mailcow-dns", () => {
  const domain = {
    name: "example.invalid",
    description: "test",
    dkim_selector: "dkim",
    dkim_key_size: 2048,
    outbound_mode: "direct",
    dns: {
      mx_priority: 10,
      spf: "v=spf1 mx a ~all",
      dmarc: "v=DMARC1; p=none",
      notes: "",
    },
  };

  it("dkimOwnerName uses selector and domain", () => {
    expect(dkimOwnerName("example.invalid", "dkim")).toBe("dkim._domainkey.example.invalid");
  });

  it("buildDnsChecklist includes MX SPF DKIM DMARC", () => {
    const records = buildDnsChecklist(domain, "mail.example.invalid", {
      dkim_txt: "v=DKIM1; k=rsa; p=abc",
    });
    const types = records.map((r) => r.type);
    expect(types).toContain("MX");
    expect(types).toContain("TXT");
    expect(records.find((r) => r.name === "example.invalid" && r.type === "TXT")?.data).toBe(
      "v=spf1 mx a ~all",
    );
    expect(records.find((r) => r.name === "_dmarc.example.invalid")?.data).toBe("v=DMARC1; p=none");
    expect(records.find((r) => r.name === "dkim._domainkey.example.invalid")?.data).toBe(
      "v=DKIM1; k=rsa; p=abc",
    );
  });

  it("buildDnsChecklist placeholder when DKIM missing", () => {
    const records = buildDnsChecklist(domain, "mail.example.invalid");
    const dkim = records.find((r) => r.name === "dkim._domainkey.example.invalid");
    expect(dkim?.data).toContain("{{dkim_txt}}");
  });

  it("buildAllDnsChecklists tags outbound mode", () => {
    const relayDomain = {
      ...domain,
      name: "relay.example.invalid",
      outbound_mode: "postfix-relay",
      dns: { ...domain.dns, spf: "v=spf1 include:spf.smtp2go.com ~all" },
    };
    const lists = buildAllDnsChecklists([domain, relayDomain], "mail.example.invalid");
    expect(lists).toHaveLength(2);
    expect(lists[1].outbound_mode).toBe("postfix-relay");
  });

  it("formatDnsChecklistMarkdown renders table", () => {
    const md = formatDnsChecklistMarkdown(buildDnsChecklist(domain, "mail.example.invalid"));
    expect(md).toContain("| Type |");
    expect(md).toContain("| MX |");
    expect(md).toContain("example.invalid");
  });
});
