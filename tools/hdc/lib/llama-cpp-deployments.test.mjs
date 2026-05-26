import { describe, expect, it } from "vitest";
import {
  instanceFlagToSystemId,
  listLlamaCppDeploymentSummaries,
  MIN_LLAMA_CPP_ROOTFS_GB,
  normalizeInstallBackend,
  normalizeLlamaCppConfig,
  resolveLlamaCppDeployment,
  resolveLlamaCppDeployments,
} from "../../../packages/services/llama-cpp/lib/deployments.mjs";

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

  it("normalizes schema v2 deployments", () => {
    const { deployments } = normalizeLlamaCppConfig(v2);
    expect(deployments).toHaveLength(2);
    expect(deployments[0].system_id).toBe("llama-cpp-a");
    expect(deployments[1].install).toMatchObject({ backend: "vulkan" });
  });

  it("resolves all deployments without selector", () => {
    const list = resolveLlamaCppDeployments(v2, {});
    expect(list.map((d) => d.systemId)).toEqual(["llama-cpp-a", "llama-cpp-b"]);
  });

  it("maps instance flag to system id", () => {
    expect(instanceFlagToSystemId("b")).toBe("llama-cpp-b");
    expect(instanceFlagToSystemId("llama-cpp-b")).toBe("llama-cpp-b");
  });

  it("resolves single deployment by instance", () => {
    const d = resolveLlamaCppDeployment(v2, { instance: "b" });
    expect(d.systemId).toBe("llama-cpp-b");
    expect(d.install.backend).toBe("vulkan");
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
