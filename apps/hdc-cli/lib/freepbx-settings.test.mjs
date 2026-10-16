import { describe, expect, it } from "vitest";
import { buildApplyPayload, buildPjsipTrunkSettings } from "hdc/clump/services/freepbx/lib/freepbx-settings.mjs";
import {
  normalizeFreepbxConfig,
  resolveFreepbxDeployments,
} from "hdc/clump/services/freepbx/lib/deployments.mjs";

describe("freepbx settings", () => {
  it("builds a Twilio PJSIP trunk without a dial prefix on the trunk", () => {
    const settings = buildPjsipTrunkSettings(
      {
        trunk_name: "twilio0",
        termination_domain: "mytrunk.pstn.example.invalid",
        outbound_proxy: "pstn.ashburn.twilio.com",
        identify_cidrs: ["54.172.60.0/23", "54.244.51.0/24"],
      },
      { username: "user", password: "secret" },
    );
    expect(settings.sip_server).toBe("mytrunk.pstn.example.invalid");
    expect(settings.outbound_proxy).toBe("sip:pstn.ashburn.twilio.com");
    expect(settings.match).toBe("54.172.60.0/23,54.244.51.0/24");
    expect(settings.registration).toBe("send");
    expect(settings.retry_interval).toBe("60");
    expect(settings).not.toHaveProperty("dialoutprefix");
  });

  it("pins RTP and the outbound dial prefix on the apply payload", () => {
    const payload = buildApplyPayload({
      freepbx: {
        rtp_port_min: 10000,
        rtp_port_max: 12499,
        nat: { external_address: "203.0.113.254", local_net: "192.0.2.0/24" },
        twilio: { enabled: true, dial_prefix: "9", trunk_name: "twilio0" },
      },
      adminPassword: "admin-secret",
      sipUsername: "user",
      sipPassword: "secret",
    });
    expect(payload.rtp_port_min).toBe(10000);
    expect(payload.rtp_port_max).toBe(12499);
    expect(payload.dial_prefix).toBe("9");
    expect(payload.pjsip.username).toBe("user");
  });
});

describe("freepbx deployments", () => {
  const cfg = {
    schema_version: 1,
    defaults: { mode: "proxmox-qemu" },
    deployments: [
      {
        system_id: "vm-freepbx-a",
        proxmox: {
          host_id: "pve-b",
          qemu: { vmid: 496, template_vmid: 9096, ip: "192.0.2.66/24" },
        },
      },
    ],
  };

  it("requires a vm-freepbx id and CIDR", () => {
    expect(normalizeFreepbxConfig(cfg).deployments).toHaveLength(1);
    expect(() =>
      normalizeFreepbxConfig({
        ...cfg,
        deployments: [{ system_id: "freepbx-a", proxmox: { host_id: "pve-b", qemu: { ip: "192.0.2.66/24", template_vmid: 1 } } }],
      }),
    ).toThrow(/vm-freepbx/);
  });

  it("filters by instance letter", () => {
    const list = resolveFreepbxDeployments(cfg, { instance: "a" });
    expect(list).toHaveLength(1);
    expect(list[0].systemId).toBe("vm-freepbx-a");
  });
});
