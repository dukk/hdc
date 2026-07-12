import { describe, expect, it } from "vitest";

// Test install script composition via reading module exports indirectly through deployments
// (installOllamaInQemu requires SSH; we only verify gpu backend resolution path exists in deployments)

import { normalizeOllamaConfig } from "../../../clumps/services/ollama/lib/deployments.mjs";

describe("ollama-qemu install config", () => {
  it("accepts nvidia gpu_backend on QEMU deployment", () => {
    const cfg = normalizeOllamaConfig({
      schema_version: 2,
      deployments: [
        {
          system_id: "vm-ollama-a",
          mode: "proxmox-qemu",
          proxmox: {
            host_id: "hypervisor-d",
            qemu: { vmid: 470, template_vmid: 9024, ip: "192.0.2.25/24" },
          },
          configure: { ssh: { host: "192.0.2.25" } },
          install: { gpu: true, gpu_backend: "nvidia" },
        },
      ],
    });
    expect(cfg.deployments[0].install).toMatchObject({
      gpu: true,
      gpu_backend: "nvidia",
    });
  });
});
