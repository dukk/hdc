import { describe, expect, it } from "vitest";
import {
  ctSystemId,
  deploymentSystemIdPattern,
  lxcSystemId,
  physicalSystemId,
  slugifyInventoryRole,
  systemIdForClass,
  vmSystemId,
} from "./lib/inventory-naming.mjs";
import { deployTargetSystemId, NAGIOS_CLUSTER_NODE_IDS } from "../../packages/lib/deploy-inventory.mjs";

describe("inventory-naming", () => {
  it("builds class-prefixed ids with letter instances", () => {
    expect(physicalSystemId("hypervisor", "a")).toBe("hypervisor-a");
    expect(vmSystemId("nginx-proxy", "a")).toBe("vm-nginx-proxy-a");
    expect(vmSystemId("nginx-proxy", "b")).toBe("vm-nginx-proxy-b");
    expect(lxcSystemId("adguard", "a")).toBe("adguard-a");
    expect(ctSystemId("adguard", "a")).toBe("adguard-a");
    expect(systemIdForClass("vm", "pi-hole", "a")).toBe("vm-pi-hole-a");
    expect(systemIdForClass("lxc", "pi-hole", "a")).toBe("pi-hole-a");
  });

  it("slugifyInventoryRole normalizes names", () => {
    expect(slugifyInventoryRole("Pi-hole DNS")).toBe("pi-hole-dns");
  });

  it("deploymentSystemIdPattern matches unprefixed role ids", () => {
    expect(deploymentSystemIdPattern("ollama").test("ollama-a")).toBe(true);
    expect(deploymentSystemIdPattern("ollama").test("ct-ollama-a")).toBe(false);
  });
});

describe("deploy-inventory", () => {
  it("maps deploy targets in DEPLOY_TARGET_WORKLOAD", () => {
    expect(deployTargetSystemId("bind")).toBe("vm-bind-a");
    expect(deployTargetSystemId("minecraft")).toBe("vm-minecraft-a");
    expect(deployTargetSystemId("ollama")).toBe("ollama-a");
    expect(deployTargetSystemId("postfix-relay")).toBe("postfix-relay-a");
    expect(deployTargetSystemId("scanopy")).toBe("scanopy-a");
  });

  it("lists nagios LXC host ids", () => {
    expect(NAGIOS_CLUSTER_NODE_IDS).toEqual(["hypervisor-a", "hypervisor-b", "hypervisor-c"]);
  });
});
