import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  applyMailRelayToSystemConfig,
  diffSystemConfigSections,
  mergeSystemConfigForMaintain,
  sanitizeSystemConfigForStorage,
  smtpSummaryFromSystemConfig,
  systemConfigChanged,
} from "../../../packages/services/immich/lib/immich-admin-config.mjs";
import { resetMailRelayClientDefaultsCache } from "../../../packages/lib/mail-relay-config.mjs";

describe("sanitizeSystemConfigForStorage", () => {
  it("strips SMTP password and OAuth client secrets", () => {
    const live = {
      notifications: {
        smtp: {
          enabled: true,
          from: "a@b.c",
          transport: { host: "smtp.example", password: "secret", port: 587 },
        },
      },
      oauth: { enabled: true, clientId: "id", clientSecret: "sec", issuerUrl: "https://idp" },
    };
    const out = sanitizeSystemConfigForStorage(live);
    expect(out.notifications.smtp.transport.password).toBe("");
    expect(out.oauth.clientId).toBe("");
    expect(out.oauth.clientSecret).toBe("");
    expect(out.oauth.issuerUrl).toBe("https://idp");
  });
});

describe("applyMailRelayToSystemConfig", () => {
  beforeEach(() => {
    resetMailRelayClientDefaultsCache();
  });

  afterEach(() => {
    resetMailRelayClientDefaultsCache();
  });

  it("sets postfix-relay host/port when mail.enabled", () => {
    const cfg = { notifications: { smtp: { enabled: false, transport: { host: "old" } } } };
    const immich = {
      mail: { enabled: true, from: "photos@hdc.dukk.org" },
    };
    applyMailRelayToSystemConfig(cfg, immich);
    expect(cfg.notifications.smtp.enabled).toBe(true);
    expect(cfg.notifications.smtp.from).toBe("photos@hdc.dukk.org");
    expect(cfg.notifications.smtp.transport.host).toBe("postfix-relay.hdc.dukk.org");
    expect(cfg.notifications.smtp.transport.port).toBe(25);
    expect(cfg.notifications.smtp.transport.secure).toBe(false);
    expect(cfg.notifications.smtp.transport.username).toBe("");
    expect(cfg.notifications.smtp.transport.password).toBe("");
  });

  it("leaves smtp unchanged when mail disabled", () => {
    const cfg = { notifications: { smtp: { enabled: false, transport: { host: "old" } } } };
    applyMailRelayToSystemConfig(cfg, { mail: { enabled: false } });
    expect(cfg.notifications.smtp.transport.host).toBe("old");
  });
});

describe("diffSystemConfigSections", () => {
  it("detects smtp host drift", () => {
    const configured = {
      notifications: { smtp: { transport: { host: "postfix-relay.hdc.dukk.org" } } },
    };
    const live = {
      notifications: { smtp: { transport: { host: "smtp.gmail.com" } } },
    };
    const drift = diffSystemConfigSections(configured, live);
    expect(drift).toContain("notifications");
  });
});

describe("mergeSystemConfigForMaintain", () => {
  beforeEach(() => {
    resetMailRelayClientDefaultsCache();
  });

  afterEach(() => {
    resetMailRelayClientDefaultsCache();
  });

  it("merges configured sections and applies mail overlay", () => {
    const live = {
      server: { externalDomain: "", publicUsers: true },
      notifications: { smtp: { enabled: false, transport: { host: "" } } },
      trash: { enabled: true, days: 30 },
    };
    const immich = {
      public_url: "https://immich.dukk.org",
      mail: { enabled: true, from: "noreply@hdc.dukk.org" },
      system_config: {
        trash: { enabled: true, days: 7 },
      },
    };
    const merged = mergeSystemConfigForMaintain(live, immich);
    expect(merged.server.externalDomain).toBe("https://immich.dukk.org");
    expect(merged.trash.days).toBe(7);
    expect(merged.notifications.smtp.transport.host).toBe("postfix-relay.hdc.dukk.org");
  });
});

describe("smtpSummaryFromSystemConfig", () => {
  it("summarizes smtp block", () => {
    const s = smtpSummaryFromSystemConfig({
      notifications: {
        smtp: {
          enabled: true,
          from: "noreply@hdc.dukk.org",
          transport: { host: "postfix-relay.hdc.dukk.org", port: 25 },
        },
      },
    });
    expect(s.enabled).toBe(true);
    expect(s.host).toBe("postfix-relay.hdc.dukk.org");
    expect(s.port).toBe(25);
  });
});

describe("systemConfigChanged", () => {
  it("detects changes", () => {
    expect(systemConfigChanged({ a: 1 }, { a: 1 })).toBe(false);
    expect(systemConfigChanged({ a: 1 }, { a: 2 })).toBe(true);
  });
});
