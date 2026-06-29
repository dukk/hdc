import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveWazuhMailConfig } from "../../../packages/services/wazuh/lib/wazuh-mail-config.mjs";
import {
  installMailRelayExampleMock,
  restoreMailRelayExampleMock,
} from "../test/mock-mail-relay-example.mjs";

describe("wazuh-mail-config", () => {
  beforeEach(() => {
    installMailRelayExampleMock();
  });

  afterEach(() => {
    restoreMailRelayExampleMock();
  });

  it("resolves mail settings from defaults using relay IP", () => {
    const resolved = resolveWazuhMailConfig({
      defaults: {
        mail: {
          enabled: true,
          to: ["ops@example.invalid"],
          alert_level: 10,
        },
      },
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.smtp_server).toBe("192.0.2.60");
    expect(resolved?.email_from).toBe("noreply@hdc.example.invalid");
    expect(resolved?.email_to).toEqual(["ops@example.invalid"]);
    expect(resolved?.notifications.smtp_sender_id).toBe("hdc-postfix-relay");
  });

  it("returns null when mail disabled or missing recipients", () => {
    expect(resolveWazuhMailConfig({ defaults: { mail: { enabled: false } } })).toBeNull();
    expect(resolveWazuhMailConfig({ defaults: { mail: { enabled: true, to: [] } } })).toBeNull();
  });
});
