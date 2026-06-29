import { describe, expect, it } from "vitest";
import {
  DEFAULT_TWILIO_IDENTIFY_CIDRS,
  mergeAsteriskSettings,
  renderRtpConf,
  renderTransportConf,
  renderTwilioDialplanConf,
  renderTwilioTrunkConf,
  rtpPortRange,
  sipPort,
  twilioCredentialPasswordVaultKey,
  twilioCredentialUsernameVaultKey,
  twilioIdentifyCidrs,
  twilioTrunkName,
} from "../../../packages/services/asterisk/lib/asterisk-render.mjs";

const baseAsterisk = {
  sip_port: 5060,
  nat: {
    enabled: true,
    local_net: "192.0.2.0/24",
    external_signaling_address: "203.0.113.1",
    external_media_address: "203.0.113.1",
  },
  twilio: {
    enabled: true,
    trunk_name: "twilio0",
    termination_domain: "mytrunk.pstn.example.invalid",
    outbound_proxy: "pstn.ashburn.twilio.com",
    origination: { context: "from-twilio" },
    termination: { dial_prefix: "9" },
  },
};

describe("asterisk render", () => {
  it("sipPort defaults to 5060", () => {
    expect(sipPort({})).toBe(5060);
    expect(sipPort({ sip_port: 5080 })).toBe(5080);
  });

  it("rtpPortRange defaults", () => {
    expect(rtpPortRange({})).toEqual({ min: 10000, max: 20000 });
  });

  it("twilio vault key helpers", () => {
    expect(twilioCredentialUsernameVaultKey({})).toBe("HDC_TWILIO_SIP_USERNAME");
    expect(twilioCredentialPasswordVaultKey({})).toBe("HDC_TWILIO_SIP_PASSWORD");
  });

  it("twilioIdentifyCidrs falls back to defaults", () => {
    expect(twilioIdentifyCidrs({})).toEqual(DEFAULT_TWILIO_IDENTIFY_CIDRS);
    expect(twilioIdentifyCidrs({ identify_cidrs: ["54.172.60.0/23"] })).toEqual([
      "54.172.60.0/23",
    ]);
  });

  it("renderTransportConf includes NAT when enabled", () => {
    const conf = renderTransportConf(baseAsterisk, 5060);
    expect(conf).toContain("[transport-udp]");
    expect(conf).toContain("external_signaling_address=203.0.113.1");
    expect(conf).toContain("local_net=192.0.2.0/24");
  });

  it("renderTwilioTrunkConf includes domain and identify CIDRs", () => {
    const conf = renderTwilioTrunkConf(baseAsterisk, {
      username: "twilio-user",
      password: "secret",
    });
    expect(conf).toContain("[twilio0-endpoint]");
    expect(conf).toContain("mytrunk.pstn.example.invalid");
    expect(conf).toContain("username=twilio-user");
    expect(conf).toContain("match=54.172.60.0/23");
    expect(conf).toContain("outbound_proxy=sip:pstn.ashburn.twilio.com");
  });

  it("renderTwilioDialplanConf includes outbound prefix dial", () => {
    const conf = renderTwilioDialplanConf(baseAsterisk);
    expect(conf).toContain("[from-twilio]");
    expect(conf).toContain("[outbound-twilio]");
    expect(conf).toContain("Dial(PJSIP/+${NUM}@twilio0-endpoint");
    expect(conf).toContain("exten => _9.");
  });

  it("renderRtpConf sets port range", () => {
    const conf = renderRtpConf({ rtp_port_min: 12000, rtp_port_max: 14000 });
    expect(conf).toContain("rtpstart=12000");
    expect(conf).toContain("rtpend=14000");
  });

  it("mergeAsteriskSettings merges deployment overrides", () => {
    const merged = mergeAsteriskSettings(baseAsterisk, {
      asterisk: { sip_port: 5080 },
    });
    expect(sipPort(merged)).toBe(5080);
    expect(twilioTrunkName(merged.twilio)).toBe("twilio0");
  });
});
