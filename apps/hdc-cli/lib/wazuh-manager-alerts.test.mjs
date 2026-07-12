import { describe, expect, it } from "vitest";
import {
  buildWazuhManagerAlertsPatchBash,
  formatWazuhManagerEmailTo,
  patchOssecXmlTag,
  patchWazuhManagerConfEmail,
  wazuhManagerAlertsSkippedByFlags,
} from "../../../clumps/lib/wazuh-manager-alerts.mjs";

const SAMPLE_CONF = `<ossec_config>
  <global>
    <email_notification>no</email_notification>
    <smtp_server>smtp.example.wazuh.com</smtp_server>
    <email_from>wazuh@example.wazuh.com</email_from>
    <email_to>recipient@example.wazuh.com</email_to>
    <email_maxperhour>12</email_maxperhour>
  </global>
  <alerts>
    <email_alert_level>12</email_alert_level>
  </alerts>
</ossec_config>
`;

describe("wazuh-manager-alerts", () => {
  it("patches global and alerts email settings", () => {
    const patched = patchWazuhManagerConfEmail(SAMPLE_CONF, {
      smtp_server: "192.0.2.60",
      email_from: "noreply@hdc.example.invalid",
      email_to: "ops@example.invalid",
      alert_level: 10,
      max_per_hour: 12,
    });
    expect(patched).toContain("<email_notification>yes</email_notification>");
    expect(patched).toContain("<smtp_server>192.0.2.60</smtp_server>");
    expect(patched).toContain("<email_from>noreply@hdc.example.invalid</email_from>");
    expect(patched).toContain("<email_to>ops@example.invalid</email_to>");
    expect(patched).toContain("<email_alert_level>10</email_alert_level>");
  });

  it("replaces a single XML tag", () => {
    expect(patchOssecXmlTag("<foo>old</foo>", "foo", "new")).toBe("<foo>new</foo>");
  });

  it("builds remote patch bash referencing manager conf and docker restart", () => {
    const bash = buildWazuhManagerAlertsPatchBash({
      smtp_server: "192.0.2.60",
      email_from: "noreply@hdc.example.invalid",
      email_to: ["ops@example.invalid"],
      alert_level: 10,
      max_per_hour: 12,
    });
    expect(bash).toContain("wazuh_manager.conf");
    expect(bash).toContain("docker compose restart wazuh.manager");
    expect(bash).toContain("192.0.2.60");
  });

  it("formats multiple manager email recipients", () => {
    expect(formatWazuhManagerEmailTo(["a@x.test", "b@x.test"])).toBe("a@x.test,b@x.test");
    expect(formatWazuhManagerEmailTo(["  a@x.test  ", ""])).toBe("a@x.test");
  });

  it("skips when --skip-wazuh-mail is set", () => {
    expect(wazuhManagerAlertsSkippedByFlags({ "skip-wazuh-mail": "1" })).toBe(true);
    expect(wazuhManagerAlertsSkippedByFlags({})).toBe(false);
  });
});
