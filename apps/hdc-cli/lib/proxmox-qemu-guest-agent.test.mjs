import { describe, expect, it } from "vitest";
import {
  classifyQemuGuestAgentRow,
  guestAgentWarningsForRow,
  guestAgentWarningsFromReport,
  httpStatusFromPveError,
  isGuestAgentPermissionError,
  qemuAgentEnabledFromConfig,
  summarizeGuestAgentCounts,
} from "hdc/clump/infrastructure/proxmox/lib/proxmox-qemu-guest-agent.mjs";

/** @type {import("hdc/clump/infrastructure/proxmox/lib/proxmox-host-load-report.mjs").GuestConfig} */
const baseGuest = {
  vmid: 107,
  name: "portainer-a",
  type: "qemu",
  node: "hypervisor-c",
  status: "running",
  maxcpu: 2,
  maxmem: 1024,
  maxdisk: 2048,
};

describe("proxmox-qemu-guest-agent", () => {
  it("qemuAgentEnabledFromConfig parses agent field variants", () => {
    expect(qemuAgentEnabledFromConfig(1)).toBe(true);
    expect(qemuAgentEnabledFromConfig("1")).toBe(true);
    expect(qemuAgentEnabledFromConfig("enabled=1")).toBe(true);
    expect(qemuAgentEnabledFromConfig("enabled=on")).toBe(true);
    expect(qemuAgentEnabledFromConfig(0)).toBe(false);
    expect(qemuAgentEnabledFromConfig(undefined)).toBe(false);
    expect(qemuAgentEnabledFromConfig("")).toBe(false);
  });

  it("classifyQemuGuestAgentRow covers running/stopped and probe outcomes", () => {
    expect(
      classifyQemuGuestAgentRow({
        guest: { ...baseGuest, status: "stopped" },
        configEnabled: false,
        probe: null,
      }),
    ).toEqual({
      agentStatus: "disabled",
      summary: "agent disabled (VM stopped)",
    });

    expect(
      classifyQemuGuestAgentRow({
        guest: { ...baseGuest, status: "stopped" },
        configEnabled: true,
        probe: null,
      }).agentStatus,
    ).toBe("enabled_stopped");

    expect(
      classifyQemuGuestAgentRow({
        guest: baseGuest,
        configEnabled: true,
        probe: { attempted: true, ok: true },
      }).agentStatus,
    ).toBe("ok");

    expect(
      classifyQemuGuestAgentRow({
        guest: baseGuest,
        configEnabled: true,
        probe: { attempted: true, ok: false, error: "timeout" },
      }).agentStatus,
    ).toBe("not_responding");

    expect(
      classifyQemuGuestAgentRow({
        guest: baseGuest,
        configEnabled: true,
        probe: {
          attempted: true,
          ok: false,
          httpStatus: 403,
          error: "Proxmox HTTP 403: permission denied",
        },
      }).agentStatus,
    ).toBe("permission_denied");
  });

  it("httpStatusFromPveError and isGuestAgentPermissionError detect 403", () => {
    expect(httpStatusFromPveError("Proxmox HTTP 403 /nodes/pve/qemu/1/agent/ping")).toBe(403);
    expect(isGuestAgentPermissionError("Proxmox HTTP 403: permission denied")).toBe(true);
    expect(isGuestAgentPermissionError("No Qemu Guest Agent")).toBe(false);
  });

  it("guestAgentWarningsForRow warns on running not_responding and permission_denied", () => {
    const warnBad = guestAgentWarningsForRow({
      vmid: 1,
      name: "vm-a",
      node: "hypervisor-b",
      status: "running",
      configEnabled: true,
      agentStatus: "not_responding",
      summary: "",
    });
    expect(warnBad[0]).toContain("not responding");

    const warnPerm = guestAgentWarningsForRow({
      vmid: 2,
      name: "vm-b",
      node: "hypervisor-b",
      status: "running",
      configEnabled: true,
      agentStatus: "permission_denied",
      summary: "",
    });
    expect(warnPerm[0]).toContain("VM.GuestAgent.Audit");
  });

  it("summarizeGuestAgentCounts aggregates by status", () => {
    const s = summarizeGuestAgentCounts([
      { agentStatus: "ok" },
      { agentStatus: "ok" },
      { agentStatus: "disabled" },
      { agentStatus: "not_responding" },
    ]);
    expect(s).toBe("2 ok, 1 not_responding, 1 disabled");
  });

  it("guestAgentWarningsFromReport collects warnings from nested clusters", () => {
    const warnings = guestAgentWarningsFromReport({
      ok: false,
      warnings: [],
      clusters: [
        {
          id: "c1",
          hosts: [
            {
              hostId: "hypervisor-b",
              pveNode: "hypervisor-b",
              guests: [
                {
                  vmid: 10,
                  name: "vm-x",
                  node: "hypervisor-b",
                  status: "running",
                  configEnabled: true,
                  agentStatus: "not_responding",
                  summary: "",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("vmid 10");
  });
});
