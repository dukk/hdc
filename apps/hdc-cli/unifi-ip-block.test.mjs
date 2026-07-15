import { describe, expect, it } from "vitest";

import {
  activeBlockIps,
  isInternalIp,
  isValidIpv4,
  ipv4InCidr,
  planBlockIp,
  planUnblockIp,
  pruneExpiredBlocks,
} from "hdc/clump/infrastructure/unifi-network/lib/unifi-ip-block.mjs";
import {
  renderMainCfSnippet,
  renderTransportMap,
} from "hdc/clump/services/postfix-relay/lib/postfix-relay-render.mjs";

describe("unifi-ip-block", () => {
  it("validates IPv4", () => {
    expect(isValidIpv4("1.2.3.4")).toBe(true);
    expect(isValidIpv4("10.0.0.256")).toBe(false);
    expect(isValidIpv4("not-an-ip")).toBe(false);
  });

  it("matches CIDRs", () => {
    expect(ipv4InCidr("10.0.0.62", "10.0.0.0/24")).toBe(true);
    expect(ipv4InCidr("10.1.0.10", "10.0.0.0/24")).toBe(false);
    expect(ipv4InCidr("10.1.0.10", "10.1.0.0/26")).toBe(true);
  });

  it("refuses internal IPs", () => {
    expect(isInternalIp("10.0.0.5")).toBe(true);
    expect(isInternalIp("8.8.8.8")).toBe(false);
  });

  it("planBlockIp rejects internal and accepts public", () => {
    const ledger = { schema_version: 1, group_name: "hdc-auto-block", blocks: [] };
    expect(planBlockIp({ ip: "10.0.0.1", ledger }).ok).toBe(false);
    const ok = planBlockIp({
      ip: "203.0.113.50",
      days: 30,
      reason: "test",
      ledger,
      now: new Date("2026-07-14T12:00:00Z"),
    });
    expect(ok.ok).toBe(true);
    expect(ok.entry?.ip).toBe("203.0.113.50");
    expect(ok.entry?.expires_at).toBe("2026-08-13T12:00:00.000Z");
  });

  it("prunes expired and unblocks", () => {
    const ledger = {
      schema_version: 1,
      group_name: "hdc-auto-block",
      blocks: [
        { ip: "203.0.113.1", expires_at: "2020-01-01T00:00:00Z" },
        { ip: "203.0.113.2", expires_at: "2099-01-01T00:00:00Z" },
      ],
    };
    const pruned = pruneExpiredBlocks(ledger, new Date("2026-07-14T00:00:00Z"));
    expect(pruned.removed).toHaveLength(1);
    expect(activeBlockIps(pruned.ledger, new Date("2026-07-14T00:00:00Z"))).toEqual(["203.0.113.2"]);
    const ub = planUnblockIp({ ip: "203.0.113.2", ledger: pruned.ledger });
    expect(ub.removed).toBe(1);
    expect(ub.ledger.blocks).toHaveLength(0);
  });
});

describe("postfix transport map", () => {
  it("renders domain routes and main.cf transport_maps", () => {
    expect(
      renderTransportMap([{ domain: "hdc.dukk.org", nexthop: "relay:[10.0.0.62]:25" }]),
    ).toContain("hdc.dukk.org\trelay:[10.0.0.62]:25");
    const main = renderMainCfSnippet({
      relayhost: "[mail.smtp2go.com]:587",
      myhostname: "postfix-relay",
      myorigin: "hdc.dukk.org",
      mynetworks: "127.0.0.0/8",
      transport: [{ domain: "hdc.dukk.org", nexthop: "relay:[10.0.0.62]:25" }],
    });
    expect(main).toContain("transport_maps = hash:/etc/postfix/transport");
  });
});
