import { describe, expect, it } from "vitest";

import {
  buildDnsChecklist,
  domainVerificationSummary,
} from "../../../packages/infrastructure/smtp2go/lib/smtp2go-dns-checklist.mjs";

describe("smtp2go-dns-checklist", () => {
  const liveRow = {
    domain: {
      fulldomain: "dukk.org",
      dkim_selector: "s1160987",
      dkim_value: "dkim.smtp2go.net",
      dkim_verified: true,
      rpath_selector: "em1160987",
      rpath_value: "return.smtp2go.net",
      rpath_verified: true,
    },
    trackers: [
      {
        subdomain: "link",
        cname_value: "track.smtp2go.net",
        cname_verified: true,
        enabled: true,
      },
    ],
  };

  it("buildDnsChecklist includes SPF, DKIM, return-path, and tracking rows", () => {
    const rows = buildDnsChecklist(liveRow);
    expect(rows.find((r) => r.purpose === "spf")?.data).toContain("spf.smtp2go.com");
    expect(rows.find((r) => r.purpose === "dkim")).toMatchObject({
      name: "s1160987._domainkey",
      data: "dkim.smtp2go.net",
      verified: true,
    });
    expect(rows.find((r) => r.purpose === "return_path")).toMatchObject({
      name: "em1160987",
      data: "return.smtp2go.net",
    });
    expect(rows.find((r) => r.purpose === "tracking")).toMatchObject({
      name: "link",
      data: "track.smtp2go.net",
    });
  });

  it("buildDnsChecklist supports mailcow spf variant", () => {
    const rows = buildDnsChecklist(liveRow, { spf_variant: "mailcow" });
    expect(rows.find((r) => r.purpose === "spf")?.data).toBe(
      "v=spf1 mx a include:spf.smtp2go.com ~all"
    );
  });

  it("domainVerificationSummary reports fully verified", () => {
    expect(domainVerificationSummary(liveRow).fully_verified).toBe(true);
  });
});
