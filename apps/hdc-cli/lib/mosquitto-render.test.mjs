import { describe, expect, it } from "vitest";
import {
  normalizeAcl,
  normalizeUsers,
  plainListenerEnabled,
  renderAclFile,
  renderMosquittoConf,
  tlsEnabled,
  tlsListenerPort,
} from "hdc/clump/services/mosquitto/lib/mosquitto-render.mjs";

describe("mosquitto render", () => {
  const base = {
    tls: { enabled: true, cert_name: "mqtt.example.test" },
    plain_listener: { enabled: false },
    users: [{ username: "ha", password_vault_key: "HDC_TEST" }],
    acl: [{ user: "ha", topic: "#", access: "readwrite" }],
  };

  it("tlsListenerPort defaults to 8883", () => {
    expect(tlsListenerPort({})).toBe(8883);
  });

  it("tlsEnabled defaults to true", () => {
    expect(tlsEnabled({})).toBe(true);
  });

  it("plainListenerEnabled defaults to false", () => {
    expect(plainListenerEnabled({})).toBe(false);
  });

  it("renderMosquittoConf disables anonymous and adds TLS listener", () => {
    const conf = renderMosquittoConf(base);
    expect(conf).toContain("allow_anonymous false");
    expect(conf).toContain("listener 8883");
    expect(conf).toContain("/etc/mosquitto/certs/fullchain.pem");
    expect(conf).not.toContain("listener 1883");
  });

  it("renderMosquittoConf includes plain listener when enabled", () => {
    const conf = renderMosquittoConf({
      ...base,
      plain_listener: { enabled: true, port: 1883 },
    });
    expect(conf).toContain("listener 1883");
  });

  it("renderAclFile emits user/topic rules", () => {
    expect(renderAclFile(base)).toContain("user ha");
    expect(renderAclFile(base)).toContain("topic readwrite #");
  });

  it("normalizeUsers requires vault keys", () => {
    const users = normalizeUsers(base);
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe("ha");
    expect(users[0].password_vault_key).toBe("HDC_TEST");
  });

  it("normalizeAcl filters empty entries", () => {
    expect(normalizeAcl({ acl: [{ user: "", topic: "#", access: "read" }] })).toHaveLength(0);
  });
});
