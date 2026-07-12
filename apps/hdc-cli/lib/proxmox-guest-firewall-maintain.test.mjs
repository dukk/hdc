import { describe, expect, it } from "vitest";
import {
  buildGuestFirewallHdcSection,
  guestFirewallPathForVmid,
  mergeGuestFirewallSection,
  vmidFromDeployment,
  HDC_GUEST_FW_MARKER_BEGIN,
  HDC_GUEST_FW_MARKER_END,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-guest-firewall-maintain.mjs";

describe("proxmox guest firewall maintain", () => {
  it("guestFirewallPathForVmid uses cluster fw path", () => {
    expect(guestFirewallPathForVmid("110")).toBe("/etc/pve/firewall/110.fw");
  });

  it("buildGuestFirewallHdcSection allows LAN and drops other inbound", () => {
    const section = buildGuestFirewallHdcSection({ cidrs: ["192.0.2.0/24"] });
    expect(section).toContain(HDC_GUEST_FW_MARKER_BEGIN);
    expect(section).toContain("IN ACCEPT -source 192.0.2.0/24");
    expect(section).toContain("IN DROP");
    expect(section).toContain("policy_in: DROP");
  });

  it("mergeGuestFirewallSection replaces hdc block", () => {
    const existing = `# old\n${HDC_GUEST_FW_MARKER_BEGIN}\nold rules\n${HDC_GUEST_FW_MARKER_END}\n`;
    const next = buildGuestFirewallHdcSection({ cidrs: ["192.168.0.0/16"] });
    const merged = mergeGuestFirewallSection(existing, next);
    expect(merged).toContain("192.168.0.0/16");
    expect(merged).not.toContain("old rules");
  });

  it("vmidFromDeployment reads lxc vmid and host_id", () => {
    const row = vmidFromDeployment({
      system_id: "pi-hole-a",
      proxmox: { host_id: "hypervisor-a", lxc: { vmid: 110 } },
    });
    expect(row).toEqual({ vmid: 110, hostId: "hypervisor-a", systemId: "pi-hole-a" });
  });
});
