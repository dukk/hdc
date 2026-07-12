import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listLlamaCppDeploymentSummaries,
  MIN_LLAMA_CPP_ROOTFS_GB,
  normalizeInstallBackend,
  normalizeLlamaCppConfig,
  resolveLlamaCppDeployment,
  resolveLlamaCppDeployments,
} from "../../../clumps/services/llama-cpp/lib/deployments.mjs";

describe("llama-cpp deployments", () => {
  const v2 = {
    schema_version: 2,
    defaults: { mode: "proxmox-lxc", proxmox: { lxc: { rootfs_gb: 128 } } },
    deployments: [
      {
        system_id: "llama-cpp-a",
        install: { backend: "cpu" },
        proxmox: { host_id: "hypervisor-d", lxc: { vmid: 480 } },
      },
      {
        system_id: "llama-cpp-b",
        install: { backend: "vulkan" },
        proxmox: { host_id: "hypervisor-c", lxc: { vmid: 481 } },
      },
    ],
  };

  const v2Qemu = {
    schema_version: 2,
    defaults: {
      mode: "proxmox-qemu",
      proxmox: {
        qemu: { template_vmid: 9024, storage: "local-lvm" },
      },
    },
    deployments: [
      {
        system_id: "vm-llama-cpp-a",
        mode: "proxmox-qemu",
        hostname: "llama-cpp-a",
        install: { backend: "cuda" },
        proxmox: {
          host_id: "pve-d",
          network: { gateway: "192.0.2.1" },
          qemu: {
            vmid: 480,
            template_vmid: 9024,
            ip: "192.0.2.28/24",
            hostpci: [{ id: "0000:01:00.0", pcie: true, rombar: false }],
          },
        },
        configure: { ssh: { user: "root", host: "192.0.2.28" } },
      },
      {
        system_id: "llama-cpp-b",
        mode: "proxmox-lxc",
        install: { backend: "vulkan" },
        proxmox: { host_id: "pve-c", lxc: { vmid: 481, rootfs_gb: 128 } },
      },
    ],
  };

  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeLlamaCppConfig(v2);
    expect(deployments).toHaveLength(2);
    expect(deployments[0].system_id).toBe("llama-cpp-a");
    expect(deployments[1].install).toMatchObject({ backend: "vulkan" });
  });

  it("normalizes vm-llama-cpp-a with hostpci", () => {
    const { deployments } = normalizeLlamaCppConfig(v2Qemu);
    expect(deployments[0].system_id).toBe("vm-llama-cpp-a");
    const q = /** @type {Record<string, unknown>} */ (deployments[0].proxmox).qemu;
    expect(q.hostpci).toHaveLength(1);
  });

  it("rejects vm- prefix on LXC deployment", () => {
    const bad = structuredClone(v2);
    bad.deployments[0].system_id = "vm-llama-cpp-a";
    expect(() => normalizeLlamaCppConfig(bad)).toThrow(/llama-cpp-<letter>/);
  });

  it("resolves all deployments without selector", () => {
    const list = resolveLlamaCppDeployments(v2, {});
    expect(list.map((d) => d.systemId)).toEqual(["llama-cpp-a", "llama-cpp-b"]);
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("b", v2.deployments)).toBe("llama-cpp-b");
    expect(instanceFlagToSystemId("llama-cpp-b", v2.deployments)).toBe("llama-cpp-b");
  });

  it("instance a resolves to vm-llama-cpp-a when configured as QEMU", () => {
    const { deployments } = normalizeLlamaCppConfig(v2Qemu);
    expect(instanceFlagToSystemId("a", deployments)).toBe("vm-llama-cpp-a");
    expect(instanceFlagToSystemId("vm-llama-cpp-a", deployments)).toBe("vm-llama-cpp-a");
  });

  it("resolves single deployment by instance", () => {
    const d = resolveLlamaCppDeployment(v2, { instance: "b" });
    expect(d.systemId).toBe("llama-cpp-b");
    expect(d.install.backend).toBe("vulkan");
  });

  it("finalizeDeployment includes configure for QEMU", () => {
    const d = resolveLlamaCppDeployment(v2Qemu, { instance: "a" });
    expect(d.systemId).toBe("vm-llama-cpp-a");
    expect(d.mode).toBe("proxmox-qemu");
    expect(d.hostname).toBe("llama-cpp-a");
    expect(d.configure).toMatchObject({ ssh: { host: "192.0.2.28" } });
  });

  it("lists deployment summaries", () => {
    const list = listLlamaCppDeploymentSummaries(v2);
    expect(list.map((x) => x.system_id)).toEqual(["llama-cpp-a", "llama-cpp-b"]);
    expect(list[1].install_backend).toBe("vulkan");
  });

  it("rejects rootfs below minimum", () => {
    const tooSmall = structuredClone(v2);
    tooSmall.defaults.proxmox.lxc.rootfs_gb = 32;
    expect(() => normalizeLlamaCppConfig(tooSmall)).toThrow(
      new RegExp(`rootfs_gb must be >= ${MIN_LLAMA_CPP_ROOTFS_GB}`),
    );
  });

  it("rejects invalid backend", () => {
    const bad = structuredClone(v2);
    bad.deployments[0].install = { backend: "metal" };
    expect(() => normalizeLlamaCppConfig(bad)).toThrow(/install\.backend/);
  });

  it("normalizeInstallBackend defaults to cpu", () => {
    expect(normalizeInstallBackend(undefined)).toBe("cpu");
    expect(normalizeInstallBackend("CUDA")).toBe("cuda");
  });
});
