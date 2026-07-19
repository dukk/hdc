import { describe, expect, it, vi } from "vitest";

import {
  buildNotificationIdList,
  normalizeUptimeKumaNotificationsConfig,
  notificationToSocketConfig,
  validateConfigNotification,
} from "hdc/clump/services/uptime-kuma/lib/uptime-kuma-notifications-config.mjs";
import { syncUptimeKumaNotifications } from "hdc/clump/services/uptime-kuma/lib/uptime-kuma-notifications-sync.mjs";

function smtpEntry(overrides = {}) {
  const { notifications } = normalizeUptimeKumaNotificationsConfig({
    notifications: [
      {
        id: "ops-mail",
        name: "Ops Mail",
        type: "smtp",
        managed: true,
        mail_to: "ops@example.invalid",
        ...overrides,
      },
    ],
  });
  return notifications[0];
}

describe("normalizeUptimeKumaNotificationsConfig smtp", () => {
  it("carries smtp fields with defaults", () => {
    const entry = smtpEntry({
      smtp_host: "mail.example.invalid",
      smtp_port: 587,
      smtp_username_env: "SMTP_USER",
      smtp_password_vault_key: "HDC_SMTP_PASS",
      mail_from: "uk@example.invalid",
    });
    expect(entry.type).toBe("smtp");
    expect(entry.smtp_host).toBe("mail.example.invalid");
    expect(entry.smtp_port).toBe(587);
    expect(entry.smtp_secure).toBe(false);
    expect(entry.smtp_ignore_tls_error).toBe(false);
    expect(entry.smtp_username_env).toBe("SMTP_USER");
    expect(entry.smtp_password_vault_key).toBe("HDC_SMTP_PASS");
    expect(entry.mail_from).toBe("uk@example.invalid");
    expect(entry.mail_to).toBe("ops@example.invalid");
    expect(entry.use_mail_relay).toBe(false);
    expect(entry.apply_to_monitors).toBe(true);
  });

  it("defaults type to discord and keeps discord fields", () => {
    const { notifications } = normalizeUptimeKumaNotificationsConfig({
      notifications: [
        {
          id: "ops-discord",
          managed: true,
          discord_webhook_vault_key: "HDC_OPS_DISCORD_WEBHOOK_URL",
        },
      ],
    });
    expect(notifications[0].type).toBe("discord");
    expect(notifications[0].discord_webhook_vault_key).toBe("HDC_OPS_DISCORD_WEBHOOK_URL");
  });
});

describe("validateConfigNotification", () => {
  it("requires mail_to for smtp", () => {
    const entry = smtpEntry({ smtp_host: "mail.example.invalid" });
    entry.mail_to = null;
    expect(() => validateConfigNotification(entry)).toThrow(/mail_to is required/);
  });

  it("requires smtp_host or use_mail_relay", () => {
    expect(() => validateConfigNotification(smtpEntry())).toThrow(/smtp_host/);
    expect(() => validateConfigNotification(smtpEntry({ use_mail_relay: true }))).not.toThrow();
    expect(() =>
      validateConfigNotification(smtpEntry({ smtp_host: "mail.example.invalid" })),
    ).not.toThrow();
  });

  it("rejects unknown types", () => {
    const { notifications } = normalizeUptimeKumaNotificationsConfig({
      notifications: [{ id: "x", type: "pager", managed: true }],
    });
    expect(() => validateConfigNotification(notifications[0])).toThrow(/unsupported type/);
  });
});

describe("notificationToSocketConfig", () => {
  it("keeps legacy string webhook argument for discord", () => {
    const { notifications } = normalizeUptimeKumaNotificationsConfig({
      notifications: [
        {
          id: "d",
          type: "discord",
          managed: true,
          discord_webhook_vault_key: "K",
        },
      ],
    });
    const cfg = notificationToSocketConfig(notifications[0], "https://discord.example/webhook");
    expect(cfg.type).toBe("discord");
    expect(cfg.discordWebhookUrl).toBe("https://discord.example/webhook");
  });

  it("builds smtp payload from entry + resolved secrets", () => {
    const entry = smtpEntry({
      smtp_host: "mail.example.invalid",
      smtp_port: 587,
      smtp_secure: true,
      mail_from: "uk@example.invalid",
      mail_cc: "cc@example.invalid",
      custom_subject: "[UK] {{name}} {{status}}",
    });
    const cfg = notificationToSocketConfig(entry, {
      smtpUsername: "user",
      smtpPassword: "pw",
    });
    expect(cfg).toMatchObject({
      type: "smtp",
      smtpHost: "mail.example.invalid",
      smtpPort: 587,
      smtpSecure: true,
      smtpUsername: "user",
      smtpPassword: "pw",
      smtpFrom: "uk@example.invalid",
      smtpTo: "ops@example.invalid",
      smtpCC: "cc@example.invalid",
      customSubject: "[UK] {{name}} {{status}}",
    });
  });

  it("prefers resolved relay host/from over entry fields", () => {
    const entry = smtpEntry({ use_mail_relay: true });
    const cfg = notificationToSocketConfig(entry, {
      smtpHost: "postfix-relay.home.example.invalid",
      smtpPort: 25,
      mailFrom: "noreply@hdc.example.invalid",
    });
    expect(cfg.smtpHost).toBe("postfix-relay.home.example.invalid");
    expect(cfg.smtpPort).toBe(25);
    expect(cfg.smtpFrom).toBe("noreply@hdc.example.invalid");
  });

  it("throws when no smtp host resolved", () => {
    const entry = smtpEntry({ use_mail_relay: true });
    expect(() => notificationToSocketConfig(entry, {})).toThrow(/no SMTP host/);
  });
});

function fakeVault(secrets = {}) {
  return {
    unlock: vi.fn(async () => {}),
    getSecret: vi.fn(async (key) => secrets[key] ?? null),
  };
}

function fakeClient() {
  return {
    addNotification: vi.fn(async () => ({ id: 11 })),
    editNotification: vi.fn(async () => ({})),
  };
}

describe("syncUptimeKumaNotifications smtp", () => {
  it("adds an smtp notification using mail relay defaults", async () => {
    const client = fakeClient();
    const entry = smtpEntry({ use_mail_relay: true });
    const result = await syncUptimeKumaNotifications(client, [entry], [], fakeVault(), {
      log: () => {},
      env: {},
      mailRelayDefaults: () => ({
        relay_hostname: "postfix-relay.home.example.invalid",
        relay_port: 25,
        default_from: "noreply@hdc.example.invalid",
      }),
    });
    expect(result.ok).toBe(true);
    expect(client.addNotification).toHaveBeenCalledTimes(1);
    const payload = client.addNotification.mock.calls[0][0];
    expect(payload.type).toBe("smtp");
    expect(payload.smtpHost).toBe("postfix-relay.home.example.invalid");
    expect(payload.smtpPort).toBe(25);
    expect(payload.smtpFrom).toBe("noreply@hdc.example.invalid");
    expect(payload.smtpTo).toBe("ops@example.invalid");
    expect(result.liveIdsByConfigId.get("ops-mail")).toBe(11);
  });

  it("resolves smtp credentials from env and vault", async () => {
    const client = fakeClient();
    const vault = fakeVault({ HDC_UK_SMTP_PASSWORD: "s3cret" });
    const entry = smtpEntry({
      smtp_host: "mail.smtp2go.com",
      smtp_port: 587,
      smtp_username_env: "HDC_UK_SMTP_USERNAME",
      smtp_password_vault_key: "HDC_UK_SMTP_PASSWORD",
      mail_from: "uk@example.invalid",
    });
    const result = await syncUptimeKumaNotifications(client, [entry], [], vault, {
      log: () => {},
      env: { HDC_UK_SMTP_USERNAME: "smtp-user" },
    });
    expect(result.ok).toBe(true);
    const payload = client.addNotification.mock.calls[0][0];
    expect(payload.smtpUsername).toBe("smtp-user");
    expect(payload.smtpPassword).toBe("s3cret");
  });

  it("fails the entry when the smtp password vault key is missing", async () => {
    const client = fakeClient();
    const entry = smtpEntry({
      smtp_host: "mail.smtp2go.com",
      smtp_password_vault_key: "HDC_MISSING",
    });
    const result = await syncUptimeKumaNotifications(client, [entry], [], fakeVault(), {
      log: () => {},
      env: {},
    });
    expect(result.ok).toBe(false);
    expect(result.results[0].error).toMatch(/HDC_MISSING/);
    expect(client.addNotification).not.toHaveBeenCalled();
  });

  it("edits an existing live notification matched by name", async () => {
    const client = fakeClient();
    const entry = smtpEntry({ smtp_host: "mail.example.invalid" });
    const result = await syncUptimeKumaNotifications(
      client,
      [entry],
      [{ id: 7, name: "Ops Mail", type: "smtp" }],
      fakeVault(),
      { log: () => {}, env: {} },
    );
    expect(result.ok).toBe(true);
    expect(client.editNotification).toHaveBeenCalledWith(expect.objectContaining({ type: "smtp" }), 7);
    expect(result.liveIdsByConfigId.get("ops-mail")).toBe(7);
  });

  it("buildNotificationIdList maps config ids to live ids", () => {
    const entry = smtpEntry({ smtp_host: "mail.example.invalid" });
    const list = buildNotificationIdList([entry], new Map([["ops-mail", 7]]), null);
    expect(list).toEqual({ "7": true });
  });
});
