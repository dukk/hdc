import { describe, expect, it } from "vitest";

import {
  buildCollectionsInstallScript,
  crowdsecCollections,
  crowdsecHubUpdateEnabled,
} from "hdc/clump/services/crowdsec/lib/crowdsec-collections.mjs";
import {
  filterBanDecisionsForUnifi,
  parseCrowdsecDecisionsJson,
  unifiBouncerGroupName,
  unifiBouncerMaxDecisions,
} from "hdc/clump/services/crowdsec/lib/crowdsec-decisions.mjs";
import {
  crowdsecBouncers,
  crowdsecFirewallBouncers,
  crowdsecUnifiBouncers,
} from "hdc/clump/services/crowdsec/lib/deployments.mjs";
import { crowdsecUnifiSyslogConfig } from "hdc/clump/services/crowdsec/lib/crowdsec-unifi-syslog.mjs";
import { guestAgentCollectionsForServices } from "hdc/package/guest-agents-config.mjs";

describe("crowdsec-collections", () => {
  it("parses collections from config", () => {
    expect(crowdsecCollections({ collections: ["crowdsecurity/linux", "  "] })).toEqual([
      "crowdsecurity/linux",
    ]);
    expect(crowdsecHubUpdateEnabled({ hub_update: false })).toBe(false);
  });

  it("builds install script with hub update and collection names", () => {
    const script = buildCollectionsInstallScript(["crowdsecurity/unifi"], { hubUpdate: true });
    expect(script).toContain("cscli hub update");
    expect(script).toContain("cscli collections install 'crowdsecurity/unifi'");
  });
});

describe("crowdsec-decisions", () => {
  it("parses decisions JSON array", () => {
    const raw = JSON.stringify([
      { value: "203.0.113.1", type: "ban", scenario: "crowdsecurity/ssh-bf" },
      { value: "10.0.0.5", type: "ban" },
    ]);
    const parsed = parseCrowdsecDecisionsJson(raw);
    expect(parsed).toHaveLength(2);
  });

  it("filters internal IPs and caps decisions", () => {
    const decisions = [
      { value: "10.0.0.5", type: "ban", scenario: "crowdsecurity/ssh-bf" },
      { value: "203.0.113.10", type: "ban", scenario: "crowdsecurity/unifi-cef" },
      { value: "203.0.113.11", type: "ban", scenario: "crowdsecurity/ssh-bf" },
    ];
    const result = filterBanDecisionsForUnifi(decisions, { maxDecisions: 1 });
    expect(result.ips).toEqual(["203.0.113.11"]);
    expect(result.capped).toBe(true);
    expect(result.total_bans).toBe(2);
  });

  it("reads unifi bouncer helpers", () => {
    expect(unifiBouncerGroupName({ group_name: "crowdsec-block" })).toBe("crowdsec-block");
    expect(unifiBouncerMaxDecisions({ max_decisions: 5000 })).toBe(5000);
  });
});

describe("crowdsec bouncer dispatch", () => {
  const crowdsec = {
    bouncers: [
      { type: "firewall", system_id: "vm-nginx-waf-a" },
      { type: "unifi", group_name: "crowdsec-block", max_decisions: 15000 },
      { type: "unifi", enabled: false, group_name: "disabled" },
    ],
  };

  it("splits firewall and unifi bouncers", () => {
    expect(crowdsecFirewallBouncers(crowdsec)).toHaveLength(1);
    expect(crowdsecUnifiBouncers(crowdsec)).toHaveLength(1);
    expect(crowdsecBouncers(crowdsec)).toHaveLength(2);
  });

  it("defaults firewall type when omitted", () => {
    const rows = crowdsecBouncers({ bouncers: [{ system_id: "vm-nginx-waf-b" }] });
    expect(rows[0].type).toBe("firewall");
    expect(rows[0].system_id).toBe("vm-nginx-waf-b");
  });
});

describe("crowdsec unifi syslog config", () => {
  it("returns null when disabled", () => {
    expect(crowdsecUnifiSyslogConfig({ unifi: { syslog: { enabled: false } } })).toBeNull();
  });

  it("parses listen port and senders", () => {
    const cfg = crowdsecUnifiSyslogConfig({
      unifi: {
        syslog: {
          enabled: true,
          listen_port: 4242,
          allowed_senders: ["10.0.0.1/32"],
        },
      },
    });
    expect(cfg?.listen_port).toBe(4242);
    expect(cfg?.allowed_senders).toEqual(["10.0.0.1/32"]);
  });
});

describe("guest agent collections", () => {
  it("merges base and service-specific collections", () => {
    const block = {
      collections: ["crowdsecurity/linux"],
      collections_by_service: {
        "nginx-waf": ["crowdsecurity/nginx"],
      },
    };
    expect(guestAgentCollectionsForServices(block, ["nginx-waf"])).toEqual([
      "crowdsecurity/linux",
      "crowdsecurity/nginx",
    ]);
  });
});
