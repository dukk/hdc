import { describe, expect, it } from "vitest";
import {
  buildEmailChannelConfig,
  buildSmtpAccountConfig,
  buildWazuhNotificationsSyncBash,
  emailChannelDrifts,
  smtpAccountDrifts,
} from "../../../clumps/services/wazuh/lib/wazuh-notifications.mjs";

/** @type {import("../../../clumps/services/wazuh/lib/wazuh-mail-config.mjs").WazuhMailSettings} */
const mail = {
  enabled: true,
  smtp_server: "192.0.2.60",
  smtp_port: 25,
  email_from: "noreply@hdc.example.invalid",
  email_to: ["ops@example.invalid"],
  alert_level: 10,
  max_per_hour: 12,
  notifications: {
    enabled: true,
    smtp_sender_id: "hdc-postfix-relay",
    email_channel_id: "hdc-wazuh-alerts",
    channel_name: "HDC Wazuh alerts",
  },
};

describe("wazuh-notifications", () => {
  it("builds SMTP sender config for internal relay", () => {
    const cfg = buildSmtpAccountConfig(mail);
    expect(cfg.config_id).toBe("hdc-postfix-relay");
    expect(cfg.config.smtp_account).toEqual({
      host: "192.0.2.60",
      port: 25,
      method: "none",
      from_address: "noreply@hdc.example.invalid",
    });
  });

  it("builds email channel config linked to SMTP sender", () => {
    const cfg = buildEmailChannelConfig(mail);
    expect(cfg.config_id).toBe("hdc-wazuh-alerts");
    expect(cfg.config.email.email_account_id).toBe("hdc-postfix-relay");
    expect(cfg.config.email.recipient_list.recipient).toEqual(["ops@example.invalid"]);
  });

  it("detects SMTP and email channel drift", () => {
    const smtp = buildSmtpAccountConfig(mail);
    const email = buildEmailChannelConfig(mail);
    expect(smtpAccountDrifts(null, smtp)).toBe(true);
    expect(smtpAccountDrifts({ smtp_account: smtp.config.smtp_account }, smtp)).toBe(false);
    expect(smtpAccountDrifts({ smtp_account: { ...smtp.config.smtp_account, host: "192.0.2.1" } }, smtp)).toBe(
      true,
    );
    expect(emailChannelDrifts(null, email)).toBe(true);
    expect(emailChannelDrifts({ email: email.config.email }, email)).toBe(false);
    expect(
      emailChannelDrifts(
        { email: { ...email.config.email, recipient_list: { recipient: ["other@example.invalid"] } } },
        email,
      ),
    ).toBe(true);
  });

  it("builds indexer notifications sync bash", () => {
    const bash = buildWazuhNotificationsSyncBash(mail);
    expect(bash).toContain("_plugins/_notifications/configs");
    expect(bash).toContain("hdc-postfix-relay");
    expect(bash).toContain("hdc-wazuh-alerts");
    expect(bash).toContain("_test");
  });
});
