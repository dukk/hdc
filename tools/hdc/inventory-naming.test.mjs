import { describe, expect, it } from "vitest";
import {
  ctSystemId,
  physicalSystemId,
  slugifyInventoryRole,
  systemIdForClass,
  vmSystemId,
} from "./lib/inventory-naming.mjs";
import { deployTargetSystemId, NAGIOS_CLUSTER_NODE_IDS } from "../../packages/lib/deploy-inventory.mjs";

describe("inventory-naming", () => {
  it("builds class-prefixed ids with letter instances", () => {
    expect(physicalSystemId("pve", "a")).toBe("pve-a");
    expect(vmSystemId("nginx-proxy", "a")).toBe("vm-nginx-proxy-a");
    expect(vmSystemId("nginx-proxy", "b")).toBe("vm-nginx-proxy-b");
    expect(ctSystemId("adguard", "a")).toBe("ct-adguard-a");
    expect(systemIdForClass("vm", "pi-hole", "a")).toBe("vm-pi-hole-a");
  });

  it("slugifyInventoryRole normalizes names", () => {
    expect(slugifyInventoryRole("Pi-hole DNS")).toBe("pi-hole-dns");
  });
});

describe("deploy-inventory", () => {
  it("maps deploy targets to vm-<role>-a", () => {
    expect(deployTargetSystemId("bind")).toBe("vm-bind-a");
    expect(deployTargetSystemId("minecraft")).toBe("vm-minecraft-a");
    expect(deployTargetSystemId("pi-hole")).toBe("vm-pi-hole-a");
    expect(deployTargetSystemId("postfix-relay")).toBe("ct-postfix-relay-a");
  });

  it("lists nagios cluster physical ids", () => {
    expect(NAGIOS_CLUSTER_NODE_IDS).toEqual(["pve-a", "pve-b", "pve-c"]);
  });
});
