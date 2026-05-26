import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  agentEnabledInConfigRecord,
  enableQemuAgentInConfig,
  qemuGuestAgentAptInstallScript,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-qemu-guest-agent-install.mjs";
import * as guestAgent from "../../../packages/infrastructure/proxmox/lib/proxmox-qemu-guest-agent.mjs";
import * as pveHttp from "../../../packages/infrastructure/proxmox/lib/pve-http.mjs";

describe("proxmox-qemu-guest-agent-install", () => {
  it("qemuGuestAgentAptInstallScript installs package and enables service", () => {
    const script = qemuGuestAgentAptInstallScript();
    expect(script).toContain("qemu-guest-agent");
    expect(script).toContain("systemctl enable --now qemu-guest-agent");
  });

  it("agentEnabledInConfigRecord detects enabled agent", () => {
    expect(agentEnabledInConfigRecord({ agent: "1" })).toBe(true);
    expect(agentEnabledInConfigRecord({ agent: 1 })).toBe(true);
    expect(agentEnabledInConfigRecord({ agent: "0" })).toBe(false);
    expect(agentEnabledInConfigRecord(null)).toBe(false);
  });

  describe("enableQemuAgentInConfig", () => {
    beforeEach(() => {
      vi.spyOn(guestAgent, "fetchQemuConfigAgentState");
      vi.spyOn(pveHttp, "pveJsonRequest");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("skips PUT when agent already enabled", async () => {
      vi.mocked(guestAgent.fetchQemuConfigAgentState).mockResolvedValue({
        enabled: true,
        config: { agent: "1" },
      });

      const result = await enableQemuAgentInConfig({
        apiBase: "https://pve.test:8006",
        node: "hypervisor-a",
        vmid: 100,
        authorization: "PVEAPIToken=x",
        rejectUnauthorized: true,
      });

      expect(result.changed).toBe(false);
      expect(pveHttp.pveJsonRequest).not.toHaveBeenCalled();
    });

    it("PUTs agent=1 when disabled in config", async () => {
      vi.mocked(guestAgent.fetchQemuConfigAgentState).mockResolvedValue({
        enabled: false,
        config: {},
      });
      vi.mocked(pveHttp.pveJsonRequest).mockResolvedValue({});

      const result = await enableQemuAgentInConfig({
        apiBase: "https://pve.test:8006",
        node: "hypervisor-a",
        vmid: 100,
        authorization: "PVEAPIToken=x",
        rejectUnauthorized: true,
      });

      expect(result.changed).toBe(true);
      expect(pveHttp.pveJsonRequest).toHaveBeenCalledWith(
        "PUT",
        "https://pve.test:8006",
        "/nodes/hypervisor-a/qemu/100/config",
        "PVEAPIToken=x",
        true,
        expect.stringContaining("agent=1"),
      );
    });
  });
});
