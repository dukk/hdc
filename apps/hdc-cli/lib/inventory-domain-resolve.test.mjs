import { describe, expect, it } from "vitest";

import { AUTOMATED_DOMAINS, MANUAL_DOMAINS, automatedDomainRel, manualSidecarRel } from "./inventory-paths.mjs";
import { mergeDomainRecords } from "./inventory-resolve.mjs";

describe("inventory domain paths", () => {
  it("uses apex FQDN sidecars under domains/", () => {
    expect(MANUAL_DOMAINS).toBe("operations/inventory/domains");
    expect(AUTOMATED_DOMAINS).toBe("operations/automated/domains");
    expect(manualSidecarRel("domains", "dukk.org")).toBe("operations/inventory/domains/dukk.org.json");
    expect(automatedDomainRel("dukk.org")).toBe("operations/automated/domains/dukk.org.json");
  });
});

describe("mergeDomainRecords", () => {
  it("lets automated win live keys while preserving manual site facts when omitted", () => {
    const manual = {
      id: "dukk.org",
      kind: "domain",
      purpose: "personal",
      notes: "keep me",
      dns: "yes",
      website: true,
      mail: "mailcow",
      renewal_usd: 10.44,
      in_config: true,
      expires_at: null,
    };
    const automated = {
      id: "dukk.org",
      kind: "domain",
      expires_at: "2027-06-01T00:00:00.000Z",
      in_account: true,
      registrar: "cloudflare",
      purpose: null,
      notes: null,
    };
    const merged = mergeDomainRecords(manual, automated);
    expect(merged.expires_at).toBe("2027-06-01T00:00:00.000Z");
    expect(merged.in_account).toBe(true);
    expect(merged.registrar).toBe("cloudflare");
    expect(merged.purpose).toBe("personal");
    expect(merged.notes).toBe("keep me");
    expect(merged.dns).toBe("yes");
    expect(merged.website).toBe(true);
    expect(merged.mail).toBe("mailcow");
    expect(merged.renewal_usd).toBe(10.44);
    expect(merged.in_config).toBe(true);
  });

  it("allows automated to override live keys when set", () => {
    const merged = mergeDomainRecords(
      { id: "a.example", expires_at: "2025-01-01T00:00:00.000Z", purpose: "old" },
      { id: "a.example", expires_at: "2028-01-01T00:00:00.000Z", purpose: "new" },
    );
    expect(merged.expires_at).toBe("2028-01-01T00:00:00.000Z");
    expect(merged.purpose).toBe("new");
  });
});
