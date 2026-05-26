import { describe, expect, it } from "vitest";
import {
  buildNet0,
  gatewayFromProxmox,
  parseIpv4FromIpConfig,
  parseIpv4FromNet0,
  resolveLxcIpConfig,
} from "../../../packages/lib/lxc-network.mjs";

describe("pi-hole lxc network", () => {
  it("uses ip_config when set", () => {
    expect(resolveLxcIpConfig({ ip_config: "10.0.0.4/24,gw=10.0.0.1" })).toBe(
      "10.0.0.4/24,gw=10.0.0.1",
    );
  });

  it("builds ip_config from ip CIDR and gateway", () => {
    expect(resolveLxcIpConfig({ ip: "10.0.0.5/24" }, { gateway: "10.0.0.1" })).toBe(
      "10.0.0.5/24,gw=10.0.0.1",
    );
  });

  it("returns null for dhcp", () => {
    expect(resolveLxcIpConfig({ ip_config: "dhcp" })).toBeNull();
    expect(resolveLxcIpConfig({})).toBeNull();
  });

  it("builds net0 line", () => {
    expect(buildNet0("vmbr0", "10.0.0.4/24,gw=10.0.0.1")).toBe(
      "name=eth0,bridge=vmbr0,ip=10.0.0.4/24,gw=10.0.0.1",
    );
  });

  it("parses IPv4 from ip_config and net0", () => {
    expect(parseIpv4FromIpConfig("10.0.0.4/24,gw=10.0.0.1")).toBe("10.0.0.4");
    expect(parseIpv4FromNet0("name=eth0,bridge=vmbr0,ip=10.0.0.5/24,gw=10.0.0.1")).toBe(
      "10.0.0.5",
    );
  });

  it("reads gateway from proxmox.network", () => {
    expect(gatewayFromProxmox({ network: { gateway: "192.168.1.1" } })).toBe("192.168.1.1");
    expect(gatewayFromProxmox({})).toBe("10.0.0.1");
  });
});
