import { describe, expect, it } from "vitest";

import {
  domainIdFromFqdn,
  liveDomainToConfig,
  normalizeSmtp2goConfig,
  resolveDomainAddOptions,
} from "./smtp2go-config.mjs";
import { collectSmtp2goState } from "./smtp2go-collect.mjs";

describe("smtp2go-config", () => {
  it("domainIdFromFqdn slugifies fqdn", () => {
    expect(domainIdFromFqdn("hdc.dukk.org")).toBe("hdc-dukk-org");
  });

  it("normalizeSmtp2goConfig reads sender_domains and defaults", () => {
    const cfg = normalizeSmtp2goConfig({
      schema_version: 1,
      smtp2go: {},
      defaults: { tracking_subdomain: "link", auto_verify: true },
      sender_domains: [
        {
          id: "hdc-dukk-org",
          domain: "hdc.dukk.org",
          managed: true,
          tracking_subdomain: "link",
        },
      ],
    });
    expect(cfg.senderDomains).toHaveLength(1);
    expect(cfg.defaults.tracking_subdomain).toBe("link");
    expect(cfg.defaults.auto_verify).toBe(true);
    expect(cfg.domainsById.get("hdc-dukk-org")?.managed).toBe(true);
  });

  it("liveDomainToConfig preserves managed flag from existing entry", () => {
    const row = {
      domain: {
        fulldomain: "dukk.org",
        rpath_selector: "em1160987",
        dkim_selector: "s1160987",
      },
      trackers: [{ subdomain: "link", enabled: true }],
    };
    const existing = {
      id: "dukk-org",
      domain: "dukk.org",
      managed: true,
      tracking_subdomain: "link",
      returnpath_subdomain: null,
      notes: "primary",
      dmarc: null,
      spf: null,
      spf_variant: null,
    };
    const next = liveDomainToConfig(row, existing);
    expect(next.managed).toBe(true);
    expect(next.notes).toBe("primary");
    expect(next.returnpath_subdomain).toBe("em1160987");
  });

  it("resolveDomainAddOptions merges entry with defaults", () => {
    const entry = {
      id: "x",
      domain: "example.com",
      managed: true,
      tracking_subdomain: null,
      returnpath_subdomain: null,
      notes: null,
      dmarc: null,
      spf: null,
      spf_variant: null,
    };
    const opts = resolveDomainAddOptions(entry, {
      tracking_subdomain: "link",
      returnpath_subdomain: null,
      auto_verify: false,
    });
    expect(opts.trackingSubdomain).toBe("link");
  });
});

describe("smtp2go-collect", () => {
  const baseConfig = normalizeSmtp2goConfig({
    schema_version: 1,
    smtp2go: {},
    sender_domains: [
      {
        id: "hdc-dukk-org",
        domain: "hdc.dukk.org",
        managed: true,
      },
      {
        id: "dukk-org",
        domain: "dukk.org",
        managed: false,
      },
    ],
  });

  const liveFixture = {
    senderDomains: [
      {
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
      },
    ],
  };

  it("collectSmtp2goState reports missing configured domain in live", () => {
    const state = collectSmtp2goState({ config: baseConfig, live: liveFixture });
    expect(state.has_drift).toBe(true);
    const hdc = state.sender_domains.find((d) => d.domain === "hdc.dukk.org");
    expect(hdc?.missing_in_live).toBe(true);
    expect(state.extra_in_live).toHaveLength(0);
  });

  it("collectSmtp2goState reports extra live domain", () => {
    const cfg = normalizeSmtp2goConfig({
      schema_version: 1,
      smtp2go: {},
      sender_domains: [],
    });
    const state = collectSmtp2goState({ config: cfg, live: liveFixture });
    expect(state.extra_in_live).toHaveLength(1);
    expect(state.extra_in_live[0].domain).toBe("dukk.org");
  });
});
