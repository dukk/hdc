import { describe, expect, it } from "vitest";

import { collectProxmoxOutages } from "hdc/clump/infrastructure/proxmox/lib/proxmox-outage-filter.mjs";

describe("proxmox-outage-filter", () => {
  it("collectProxmoxOutages flags stopped guests", () => {
    const result = collectProxmoxOutages({
      systems: [
        {
          id: "hypervisor-a",
          system_class: "physical",
          tags: ["proxmox", "automated"],
          node_status: { status: "online" },
        },
        {
          id: "ollama-a",
          system_class: "virtual",
          tags: ["proxmox", "automated"],
          virtual_hardware: { status: "running", vmid: 470, name: "ollama-a", type: "lxc" },
          query_last: { pve_node: "pve-a" },
        },
        {
          id: "vm-bind-a",
          system_class: "virtual",
          tags: ["proxmox", "automated"],
          virtual_hardware: { status: "stopped", vmid: 120, name: "vm-bind-a", type: "qemu" },
          query_last: { pve_node: "pve-a" },
        },
      ],
    });
    expect(result.failing_count).toBe(1);
    expect(result.failing[0].id).toBe("vm-bind-a");
    expect(result.failing[0].status).toBe("stopped");
  });
});
