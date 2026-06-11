import { describe, expect, it } from "vitest";
import { resolveWazuhMailConfig } from "../../../packages/services/wazuh/lib/wazuh-mail-config.mjs";

describe("wazuh-mail-config", () => {
  it("resolves mail settings from defaults using relay IP", () => {
    const resolved = resolveWazuhMailConfig({
      defaults: {
        mail: {
          enabled: true,
          to: ["dukk@dukk.org"],
          alert_level: 10,
        },
      },
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.smtp_server).toBe("10.0.0.60");
    expect(resolved?.email_from).toBe("noreply@hdc.dukk.org");
    expect(resolved?.email_to).toEqual(["dukk@dukk.org"]);
    expect(resolved?.notifications.smtp_sender_id).toBe("hdc-postfix-relay");
  });

  it("returns null when mail disabled or missing recipients", () => {
    expect(resolveWazuhMailConfig({ defaults: { mail: { enabled: false } } })).toBeNull();
    expect(resolveWazuhMailConfig({ defaults: { mail: { enabled: true, to: [] } } })).toBeNull();
  });
});
